"""Montaggio video locale: immagini + voce + sottotitoli, uniti con ffmpeg.

Tutto sul PC, senza servizi esterni e senza generazione AI: le scene usano immagini
che esistono gia' (create dagli agenti, caricate dall'utente) oppure cartoncini di
testo disegnati in locale. La voce arriva da Piper, i sottotitoli sono bruciati nel
video e salvati anche come .srt e .vtt.

La generazione AI di immagini e clip e' un'altra cosa e vive in wip/media.py (M2).
"""
from __future__ import annotations

import asyncio
import contextlib
import json
import logging
import math
import os
import re
import shutil
import subprocess
import uuid
import wave
from pathlib import Path
from typing import Any

log = logging.getLogger("ailocale.video")

ASPECTS = {"9:16": (1080, 1920), "16:9": (1920, 1080), "1:1": (1080, 1080), "4:5": (1080, 1350)}
MAX_SCENES = 40
MAX_SECONDS = 15 * 60


# ---------------------------------------------------------------------------
# Strumenti di base
# ---------------------------------------------------------------------------
def ffmpeg_exe() -> str | None:
    try:
        import imageio_ffmpeg
        p = imageio_ffmpeg.get_ffmpeg_exe()
        if p and Path(p).exists():
            return p
    except Exception:  # noqa: BLE001
        pass
    return shutil.which("ffmpeg")


def ffprobe_exe() -> str | None:
    found = shutil.which("ffprobe")
    if found:
        return found
    ff = ffmpeg_exe()                      # imageio-ffmpeg porta solo ffmpeg
    if ff and Path(ff).with_name("ffprobe").exists():
        return str(Path(ff).with_name("ffprobe"))
    return None


def slug(text: str, n: int = 40) -> str:
    s = re.sub(r"[^a-z0-9]+", "-", (text or "").lower()).strip("-")[:n]
    return s or uuid.uuid4().hex[:8]


def font(size: int):
    from PIL import ImageFont
    for c in (r"C:\Windows\Fonts\segoeuib.ttf", r"C:\Windows\Fonts\arialbd.ttf",
              "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
              "/System/Library/Fonts/Supplemental/Arial Bold.ttf"):
        if os.path.exists(c):
            return ImageFont.truetype(c, size)
    try:
        return ImageFont.load_default(size=size)
    except TypeError:
        return ImageFont.load_default()


def wav_seconds(path: Path) -> float:
    with wave.open(str(path), "rb") as w:
        return w.getnframes() / float(w.getframerate() or 1)


def wrap(text: str, f, max_w: int, draw) -> list[str]:
    lines, cur = [], ""
    for w in text.split():
        test = (cur + " " + w).strip()
        if draw.textlength(test, font=f) <= max_w or not cur:
            cur = test
        else:
            lines.append(cur)
            cur = w
    if cur:
        lines.append(cur)
    return lines


def chunk_words(text: str, max_words: int = 5) -> list[str]:
    out, cur = [], []
    for w in text.split():
        cur.append(w)
        if len(cur) >= max_words or re.search(r"[.!?;:]$", w):
            out.append(" ".join(cur))
            cur = []
    if cur:
        out.append(" ".join(cur))
    return [c for c in out if c] or ([text.strip()] if text.strip() else [])


def cover(img, w: int, h: int):
    """Ritaglia e scala come CSS object-fit: cover."""
    from PIL import Image
    iw, ih = img.size
    scale = max(w / iw, h / ih)
    img = img.convert("RGB").resize((max(w, round(iw * scale)), max(h, round(ih * scale))), Image.LANCZOS)
    return img.crop(((img.width - w) // 2, (img.height - h) // 2,
                     (img.width - w) // 2 + w, (img.height - h) // 2 + h))


def title_card(text: str, w: int, h: int, accent=(240, 180, 76)):
    from PIL import Image, ImageDraw
    img = Image.new("RGB", (w, h), (24, 22, 19))
    d = ImageDraw.Draw(img)
    d.rectangle([0, 0, w, max(4, int(h * 0.012))], fill=accent)
    f = font(int(w * 0.075))
    lines = wrap(text or " ", f, int(w * 0.82), d)[:6]
    lh = int(w * 0.095)
    y = (h - lh * len(lines)) // 2
    for ln in lines:
        d.text(((w - d.textlength(ln, font=f)) / 2, y), ln, font=f, fill=(237, 235, 228))
        y += lh
    return img


def caption_png(text: str, w: int, h: int, path: Path) -> None:
    """Sottotitolo stile short: bianco, grande, con contorno, nel terzo inferiore."""
    from PIL import Image, ImageDraw
    img = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    size = int(min(w, h) * (0.075 if h > w else 0.055))
    f = font(size)
    lines = wrap(text, f, int(w * 0.84), d)[:3]
    lh = int(size * 1.22)
    y = int(h * (0.70 if h > w else 0.78)) - lh * len(lines) // 2
    for ln in lines:
        d.text(((w - d.textlength(ln, font=f)) / 2, y), ln, font=f, fill=(255, 255, 255, 255),
               stroke_width=max(3, size // 12), stroke_fill=(0, 0, 0, 235))
        y += lh
    img.save(path)


def ts_srt(t: float) -> str:
    ms = int(round(t * 1000))
    h, ms = divmod(ms, 3_600_000)
    m, ms = divmod(ms, 60_000)
    s, ms = divmod(ms, 1000)
    return f"{h:02d}:{m:02d}:{s:02d},{ms:03d}"


def ts_vtt(t: float) -> str:
    return ts_srt(t).replace(",", ".")


def build_subtitles(cues: list[tuple[float, float, str]]) -> tuple[str, str]:
    srt, vtt = [], ["WEBVTT", ""]
    for i, (a, b, text) in enumerate(cues, 1):
        srt += [str(i), f"{ts_srt(a)} --> {ts_srt(b)}", text, ""]
        vtt += [f"{ts_vtt(a)} --> {ts_vtt(b)}", text, ""]
    return "\n".join(srt), "\n".join(vtt)


async def run(argv: list[str], cwd: Path, timeout: float, log_path: Path | None = None) -> tuple[int, str]:
    flags = subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0  # type: ignore[attr-defined]
    proc = await asyncio.create_subprocess_exec(*argv, cwd=str(cwd), stdout=asyncio.subprocess.PIPE,
                                                stderr=asyncio.subprocess.STDOUT, creationflags=flags)
    try:
        out, _ = await asyncio.wait_for(proc.communicate(), timeout=timeout)
    except asyncio.TimeoutError:
        proc.kill()
        await proc.wait()
        return -1, "timeout"
    text = (out or b"").decode("utf-8", errors="replace")
    if log_path is not None:
        with contextlib.suppress(OSError):
            log_path.parent.mkdir(parents=True, exist_ok=True)
            with log_path.open("a", encoding="utf-8") as fh:
                fh.write(f"\n$ {' '.join(argv)}\n{text[-8000:]}\n")
    return proc.returncode or 0, text


# ---------------------------------------------------------------------------
class VideoStudio:
    def __init__(self, settings: Any):
        self.settings = settings
        self.log_path = settings.data_dir / "logs" / "video.log"

    def status(self) -> dict:
        ff, fp = ffmpeg_exe(), ffprobe_exe()
        return {"ffmpeg": bool(ff), "ffmpeg_path": ff, "ffprobe": bool(fp),
                "hint": None if ff else "Montaggio video non disponibile: installa ffmpeg "
                                        "(.venv\\Scripts\\pip install imageio-ffmpeg)"}

    async def probe(self, path: Path) -> dict:
        """Misura reale del file prodotto: serve al Critico per verificare invece di fidarsi.

        Preferisce ffprobe; se manca (imageio-ffmpeg porta solo ffmpeg) legge i dati
        dall'intestazione che ffmpeg stampa all'apertura del file.
        """
        fp = ffprobe_exe()
        if not fp:
            return await self._probe_with_ffmpeg(path)
        code, out = await run([fp, "-v", "error", "-print_format", "json", "-show_format", "-show_streams",
                               str(path)], path.parent, 60)
        if code != 0:
            raise RuntimeError(f"ffprobe ha fallito: {out[-200:]}")
        data = json.loads(out)
        v = next((s for s in data.get("streams", []) if s.get("codec_type") == "video"), {})
        a = next((s for s in data.get("streams", []) if s.get("codec_type") == "audio"), {})
        fps = 0.0
        if v.get("avg_frame_rate", "0/0") not in ("0/0", None):
            num, _, den = v["avg_frame_rate"].partition("/")
            fps = round(float(num) / float(den or 1), 2) if float(den or 1) else 0.0
        return {"seconds": round(float(data.get("format", {}).get("duration") or 0), 2),
                "width": v.get("width"), "height": v.get("height"), "fps": fps,
                "video_codec": v.get("codec_name"), "audio_codec": a.get("codec_name") or None,
                "size_bytes": int(data.get("format", {}).get("size") or 0)}

    async def _probe_with_ffmpeg(self, path: Path) -> dict:
        ff = ffmpeg_exe()
        if not ff:
            raise RuntimeError("ne' ffprobe ne' ffmpeg sono disponibili per misurare il file")
        _, out = await run([ff, "-hide_banner", "-i", str(path)], path.parent, 60)   # esce con 1: e' normale
        seconds = 0.0
        m = re.search(r"Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)", out)
        if m:
            seconds = round(int(m.group(1)) * 3600 + int(m.group(2)) * 60 + float(m.group(3)), 2)
        v = re.search(r"Stream #\d+:\d+.*?: Video: (\w+).*?, (\d+)x(\d+)", out, re.S)
        fps_m = re.search(r"(\d+(?:\.\d+)?) fps", out)
        a = re.search(r"Stream #\d+:\d+.*?: Audio: (\w+)", out, re.S)
        if not v:
            raise RuntimeError(f"ffmpeg non ha riconosciuto un flusso video in {path.name}")
        return {"seconds": seconds, "width": int(v.group(2)), "height": int(v.group(3)),
                "fps": float(fps_m.group(1)) if fps_m else 0.0, "video_codec": v.group(1),
                "audio_codec": a.group(1) if a else None,
                "size_bytes": path.stat().st_size if path.is_file() else 0,
                "measured_with": "ffmpeg"}

    async def make(self, *, scenes: list[dict], out_path: Path, workdir: Path, aspect: str = "9:16",
                   voice: Any = None, music: Path | None = None, title: str = "",
                   captions: bool = True, subtitle_files: bool = True) -> dict:
        ff = ffmpeg_exe()
        if not ff:
            raise RuntimeError(self.status()["hint"])
        if not scenes:
            raise ValueError("servono delle scene")
        if len(scenes) > MAX_SCENES:
            raise ValueError(f"troppe scene (massimo {MAX_SCENES})")
        W, H = ASPECTS.get(aspect, ASPECTS["9:16"])
        tmp = workdir / ".video" / uuid.uuid4().hex[:8]
        tmp.mkdir(parents=True, exist_ok=True)
        notes: list[str] = []
        report: dict[str, Any] = {"scenes": len(scenes), "voice": False, "notes": notes}
        try:
            from PIL import Image
            segments: list[tuple[Path, float]] = []
            cues: list[tuple[float, float, str]] = []
            clock = 0.0

            for i, sc in enumerate(scenes):
                text = str(sc.get("narration") or sc.get("text") or "").strip()

                # voce (Piper): decide la durata reale della scena
                audio = None
                dur = max(2.5, len(text.split()) / 2.6) if text else 3.0
                if voice is not None and text:
                    try:
                        wav = await voice.speak(text)
                        audio = tmp / f"voce{i}.wav"
                        audio.write_bytes(wav)
                        dur = wav_seconds(audio) + 0.35
                        report["voice"] = True
                    except Exception as exc:  # noqa: BLE001
                        if not any("Voce" in n for n in notes):
                            notes.append(f"Voce non disponibile ({type(exc).__name__}): video senza parlato.")
                        audio = None
                if sc.get("seconds"):
                    dur = float(sc["seconds"])
                dur = max(0.8, min(float(dur), 120.0))
                if clock + dur > MAX_SECONDS:
                    notes.append(f"Interrotto alla scena {i + 1}: superato il limite di {MAX_SECONDS // 60} minuti.")
                    break

                # sfondo
                base = tmp / f"bg{i}.png"
                img_path = sc.get("image")
                card = str(sc.get("card") or sc.get("title") or "").strip()
                drew_card = False
                if img_path and Path(img_path).is_file():
                    try:
                        cover(Image.open(img_path), W, H).save(base)
                    except Exception as exc:  # noqa: BLE001
                        notes.append(f"Scena {i + 1}: immagine illeggibile ({type(exc).__name__}), uso un cartoncino.")
                        title_card(card or title or text, W, H).save(base)
                        drew_card = True
                else:
                    if img_path:
                        notes.append(f"Scena {i + 1}: immagine non trovata, uso un cartoncino.")
                    title_card(card or title or text, W, H).save(base)
                    drew_card = True

                # sottotitoli: blocchi con tempi proporzionali alle parole.
                # Su un cartoncino che gia' mostra la narrazione non li imprimo (li scriverei due volte),
                # ma restano nei file .srt/.vtt.
                burn = captions and sc.get("captions", True) and not (drew_card and not card and not title)
                parts = chunk_words(text) if text else []
                total_w = sum(len(p.split()) for p in parts) or 1
                caps, t0 = [], 0.0
                for k, ptxt in enumerate(parts):
                    span = dur * len(ptxt.split()) / total_w
                    if burn:
                        cp = tmp / f"cap{i}_{k}.png"
                        caption_png(ptxt, W, H, cp)
                        caps.append((cp, t0, min(t0 + span, dur)))
                    cues.append((clock + t0, clock + min(t0 + span, dur), ptxt))
                    t0 += span

                # montaggio della scena: zoom lento alternato + sottotitoli + audio
                fps = 30
                frames = max(1, int(math.ceil(dur * fps)))
                z = f"1+0.10*on/{frames}" if i % 2 == 0 else f"1.10-0.10*on/{frames}"
                inputs = ["-i", str(base)]
                filt = [f"[0:v]scale={W * 2}:{H * 2},zoompan=z='{z}':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)'"
                        f":d={frames}:s={W}x{H}:fps={fps},trim=duration={dur:.3f},setpts=PTS-STARTPTS[bg]"]
                last = "bg"
                for k, (cp, a, b) in enumerate(caps):
                    inputs += ["-i", str(cp)]
                    filt.append(f"[{last}][{k + 1}:v]overlay=0:0:enable='between(t,{a:.3f},{b:.3f})'[v{k}]")
                    last = f"v{k}"
                ai = len(caps) + 1
                if audio is not None:
                    inputs += ["-i", str(audio)]
                    amap = ["-map", f"{ai}:a", "-af", f"apad=whole_dur={dur:.3f}"]
                else:
                    inputs += ["-f", "lavfi", "-t", f"{dur:.3f}", "-i", "anullsrc=r=44100:cl=stereo"]
                    amap = ["-map", f"{ai}:a"]
                seg = tmp / f"scena{i:02d}.mp4"
                code, out = await run([ff, "-y", *inputs, "-filter_complex", ";".join(filt), "-map", f"[{last}]",
                                       *amap, "-t", f"{dur:.3f}", "-c:v", "libx264", "-preset", "veryfast",
                                       "-crf", "21", "-pix_fmt", "yuv420p", "-r", str(fps), "-c:a", "aac",
                                       "-b:a", "160k", "-ar", "44100", "-ac", "2", str(seg)],
                                      tmp, 900, self.log_path)
                if code != 0 or not seg.is_file():
                    raise RuntimeError(f"montaggio della scena {i + 1} non riuscito: {out[-300:]}")
                segments.append((seg, dur))
                clock += dur

            if not segments:
                raise RuntimeError("nessuna scena montata")

            # unione
            lst = tmp / "scene.txt"
            lst.write_text("".join(f"file '{p.as_posix()}'\n" for p, _ in segments), encoding="utf-8")
            joined = tmp / "unito.mp4"
            code, out = await run([ff, "-y", "-f", "concat", "-safe", "0", "-i", str(lst), "-c", "copy",
                                   str(joined)], tmp, 600, self.log_path)
            if code != 0:
                raise RuntimeError(f"unione delle scene non riuscita: {out[-300:]}")

            out_path.parent.mkdir(parents=True, exist_ok=True)
            if music is not None and Path(music).is_file():
                code, out = await run(
                    [ff, "-y", "-i", str(joined), "-stream_loop", "-1", "-i", str(music), "-filter_complex",
                     "[1:a]volume=0.12[m];[0:a][m]amix=inputs=2:duration=first:dropout_transition=0[a]",
                     "-map", "0:v", "-map", "[a]", "-c:v", "copy", "-c:a", "aac", "-b:a", "160k",
                     "-movflags", "+faststart", str(out_path)], tmp, 600, self.log_path)
                if code != 0:
                    raise RuntimeError(f"aggiunta della musica non riuscita: {out[-300:]}")
            else:
                code, out = await run([ff, "-y", "-i", str(joined), "-c", "copy", "-movflags", "+faststart",
                                       str(out_path)], tmp, 300, self.log_path)
                if code != 0:
                    raise RuntimeError(f"scrittura del file finale non riuscita: {out[-300:]}")

            # sottotitoli a fianco
            subs: list[str] = []
            if subtitle_files and cues:
                srt, vtt = build_subtitles(cues)
                out_path.with_suffix(".srt").write_text(srt, encoding="utf-8")
                out_path.with_suffix(".vtt").write_text(vtt, encoding="utf-8")
                subs = [str(out_path.with_suffix(".srt")), str(out_path.with_suffix(".vtt"))]

            # verifica reale del file prodotto
            measured: dict[str, Any] = {}
            with contextlib.suppress(Exception):
                measured = await self.probe(out_path)
            report.update({"path": str(out_path), "scenes_used": len(segments), "cues": len(cues),
                           "subtitles": subs, "planned_seconds": round(clock, 2),
                           "measured": measured, "width": W, "height": H,
                           "size_bytes": out_path.stat().st_size})
            if measured.get("seconds") and abs(measured["seconds"] - clock) > 1.0:
                notes.append(f"Durata misurata {measured['seconds']}s diversa da quella prevista {clock:.1f}s.")
            return report
        finally:
            shutil.rmtree(tmp, ignore_errors=True)
