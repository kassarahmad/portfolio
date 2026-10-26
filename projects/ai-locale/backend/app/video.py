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
XFADE = 0.45          # durata della dissolvenza fra una scena e l'altra

# Movimenti di camera alternati: un solo zoom ripetuto rende il video monotono.
# x e y sono espressioni ffmpeg, 'on' e' il numero di fotogramma.
MOVES = [
    ("1+0.14*on/{n}", "iw/2-(iw/zoom/2)", "ih/2-(ih/zoom/2)"),            # zoom avanti, centro
    ("1.14-0.14*on/{n}", "iw/2-(iw/zoom/2)", "ih/2-(ih/zoom/2)"),         # zoom indietro
    ("1.12", "(iw-iw/zoom)*on/{n}", "ih/2-(ih/zoom/2)"),                  # carrello a destra
    ("1.12", "(iw-iw/zoom)*(1-on/{n})", "ih/2-(ih/zoom/2)"),              # carrello a sinistra
    ("1+0.12*on/{n}", "iw/2-(iw/zoom/2)", "(ih-ih/zoom)*on/{n}"),         # scende e stringe
    ("1.12-0.12*on/{n}", "iw/2-(iw/zoom/2)", "(ih-ih/zoom)*(1-on/{n})"),  # sale e allarga
]

# Ritocco colore per le foto: un filo di calore e contrasto, come fa un fotografo
# di cibo. Non si applica ai cartoncini, che hanno gia' il loro colore.
VIDEO_EXT = {".mp4", ".mov", ".m4v", ".webm", ".mkv", ".avi"}

GRADE = "eq=contrast=1.06:saturation=1.10:gamma=0.98,colorbalance=rm=0.04:gh=0.01:bs=-0.03"
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


# Sfondi per le scene senza immagine: tonalita' calde diverse, cosi' le scene non
# sembrano tutte lo stesso fotogramma fermo.
CARD_COLORS = [((28, 24, 20), (58, 38, 24)), ((22, 26, 30), (28, 52, 64)),
               ((30, 22, 26), (66, 30, 42)), ((24, 28, 24), (32, 58, 40)),
               ((30, 26, 20), (72, 52, 20)), ((24, 22, 30), (42, 34, 70))]


def gradient(w: int, h: int, index: int = 0):
    """Sfondo con una sfumatura verticale: discreto, e diverso per ogni scena."""
    from PIL import Image, ImageDraw
    alto, basso = CARD_COLORS[index % len(CARD_COLORS)]
    img = Image.new("RGB", (1, h))
    d = ImageDraw.Draw(img)
    for y in range(h):
        k = y / max(h - 1, 1)
        d.point((0, y), fill=tuple(round(a + (b - a) * k) for a, b in zip(alto, basso)))
    return img.resize((w, h))


def title_card(text: str, w: int, h: int, accent=(240, 180, 76), index: int = 0):
    from PIL import Image, ImageDraw  # noqa: F401
    img = gradient(w, h, index)
    d = ImageDraw.Draw(img)
    d.rectangle([0, 0, w, max(4, int(h * 0.012))], fill=accent)
    if not (text or "").strip():
        return img
    f = font(int(w * 0.075))
    lines = wrap(text, f, int(w * 0.82), d)[:6]
    lh = int(w * 0.095)
    y = int(h * 0.30) - lh * len(lines) // 2      # in alto: sotto ci vanno i sottotitoli
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


def is_video(path: str | Path) -> bool:
    return Path(path).suffix.lower() in VIDEO_EXT


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

    async def _audio_di(self, path: Path) -> bool:
        """Lo spezzone ha una traccia audio utilizzabile?"""
        try:
            return bool((await self.probe(path)).get("audio_codec"))
        except Exception:  # noqa: BLE001
            return False

    async def make(self, *, scenes: list[dict], out_path: Path, workdir: Path, aspect: str = "9:16",
                   voice: Any = None, music: Path | None = None, title: str = "",
                   captions: bool = True, subtitle_files: bool = True,
                   transitions: bool = True) -> dict:
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
                # I sottotitoli non devono mai cadere dentro una dissolvenza: due scene
                # sovrapposte mostrerebbero due testi uno sull'altro, illeggibili. Quindi la
                # voce entra dopo l'incrocio in ingresso ed esce prima di quello in uscita.
                lead = XFADE if (transitions and i > 0) else 0.2
                tail = (XFADE + 0.15) if transitions else 0.35
                parlato = 0.0
                dur = max(2.5, len(text.split()) / 2.6) if text else 3.0
                if voice is not None and text:
                    try:
                        wav = await voice.speak(text)
                        audio = tmp / f"voce{i}.wav"
                        audio.write_bytes(wav)
                        parlato = wav_seconds(audio)
                        dur = lead + parlato + tail
                        report["voice"] = True
                    except Exception as exc:  # noqa: BLE001
                        if not any("Voce" in n for n in notes):
                            notes.append(f"Voce non disponibile ({type(exc).__name__}): video senza parlato.")
                        audio = None
                if sc.get("seconds"):
                    dur = float(sc["seconds"])
                dur = max(lead + tail + 0.8, min(float(dur), 120.0))
                if clock + dur > MAX_SECONDS:
                    notes.append(f"Interrotto alla scena {i + 1}: superato il limite di {MAX_SECONDS // 60} minuti.")
                    break

                # sfondo: una foto, uno spezzone girato col telefono, oppure un cartoncino
                base = tmp / f"bg{i}.png"
                img_path = sc.get("image") or sc.get("video")
                card = str(sc.get("card") or sc.get("title") or "").strip()
                # Il titolo generale vale da copertina: ripeterlo su ogni scena fa sembrare
                # il video un fermo immagine. Dalla seconda in poi conta solo il testo della scena.
                if not card and i == 0:
                    card = title.strip()
                drew_card = False
                clip: Path | None = None
                if img_path and Path(img_path).is_file() and is_video(img_path):
                    clip = Path(img_path)
                    try:
                        misura = await self.probe(clip)
                        lunghezza = float(misura.get("seconds") or 0)
                    except Exception as exc:  # noqa: BLE001
                        notes.append(f"Scena {i + 1}: video illeggibile ({type(exc).__name__}), uso uno sfondo.")
                        clip, lunghezza = None, 0.0
                        title_card(card, W, H, index=i).save(base)   # senza questo la scena resterebbe vuota
                        drew_card = True
                    if clip is not None:
                        if lunghezza < dur - 0.2:      # lo spezzone e' piu' corto del parlato
                            notes.append(f"Scena {i + 1}: lo spezzone dura {lunghezza:.1f}s, "
                                         f"meno del parlato ({dur:.1f}s): l'ultimo fotogramma resta fermo.")
                        if not text and not sc.get("seconds"):
                            dur = max(lead + tail + 0.8, min(lunghezza, 120.0))
                elif img_path and Path(img_path).is_file():
                    try:
                        cover(Image.open(img_path), W, H).save(base)
                    except Exception as exc:  # noqa: BLE001
                        notes.append(f"Scena {i + 1}: immagine illeggibile ({type(exc).__name__}), uso uno sfondo.")
                        title_card(card, W, H, index=i).save(base)
                        drew_card = True
                else:
                    if img_path:
                        notes.append(f"Scena {i + 1}: file non trovato, uso uno sfondo.")
                    title_card(card, W, H, index=i).save(base)
                    drew_card = True

                # sottotitoli: blocchi con tempi proporzionali alle parole.
                # Su un cartoncino che gia' mostra la narrazione non li imprimo (li scriverei due volte),
                # ma restano nei file .srt/.vtt.
                burn = captions and sc.get("captions", True)
                parts = chunk_words(text) if text else []
                total_w = sum(len(p.split()) for p in parts) or 1
                # Finestra dei sottotitoli: il parlato se c'e', altrimenti la scena meno i margini.
                # In entrambi i casi resta fuori dalle dissolvenze.
                finestra = parlato if parlato else max(0.6, dur - lead - tail)
                caps, t0 = [], lead
                for k, ptxt in enumerate(parts):
                    span = finestra * len(ptxt.split()) / total_w
                    if burn:
                        cp = tmp / f"cap{i}_{k}.png"
                        caption_png(ptxt, W, H, cp)
                        caps.append((cp, t0, min(t0 + span, dur)))
                    cues.append((clock + t0, clock + min(t0 + span, dur), ptxt))
                    t0 += span

                # montaggio della scena: movimento di camera variato, ritocco colore, sottotitoli, audio
                fps = 30
                frames = max(1, int(math.ceil(dur * fps)))
                grade = f",{GRADE}" if not drew_card else ""     # le riprese si ritoccano, i cartoncini no
                if clip is not None:
                    # Spezzone reale: niente zoompan finto, si ritaglia al formato e si tiene il movimento vero.
                    # tpad ripete l'ultimo fotogramma se lo spezzone finisce prima del parlato.
                    inputs = ["-i", str(clip)]
                    filt = [f"[0:v]scale={W}:{H}:force_original_aspect_ratio=increase,crop={W}:{H},"
                            f"fps={fps}{grade},tpad=stop_mode=clone:stop_duration={dur:.3f},"
                            f"trim=duration={dur:.3f},setpts=PTS-STARTPTS[bg]"]
                else:
                    z, mx, my = MOVES[i % len(MOVES)]
                    z, mx, my = z.format(n=frames), mx.format(n=frames), my.format(n=frames)
                    inputs = ["-i", str(base)]
                    filt = [f"[0:v]scale={W * 2}:{H * 2},zoompan=z='{z}':x='{mx}':y='{my}'"
                            f":d={frames}:s={W}x{H}:fps={fps}{grade},trim=duration={dur:.3f},"
                            f"setpts=PTS-STARTPTS[bg]"]
                last = "bg"
                for k, (cp, a, b) in enumerate(caps):
                    inputs += ["-i", str(cp)]
                    filt.append(f"[{last}][{k + 1}:v]overlay=0:0:enable='between(t,{a:.3f},{b:.3f})'[v{k}]")
                    last = f"v{k}"
                # Audio della scena: la voce, piu' l'ambiente dello spezzone se c'e'
                # (il crepitio del forno, il rumore del locale) tenuto sotto alla voce.
                ambiente = (clip is not None and sc.get("ambient", True)
                            and bool((await self._audio_di(clip)) if clip else False))
                ai = len(caps) + 1
                if audio is not None:
                    inputs += ["-i", str(audio)]
                    ritardo = int(lead * 1000)
                    voce_f = (f"adelay={ritardo}|{ritardo}," if ritardo else "") + f"apad=whole_dur={dur:.3f}"
                    if ambiente:
                        vol = float(sc.get("ambient_volume", 0.18))
                        filt.append(f"[{ai}:a]{voce_f}[voce]")
                        filt.append(f"[0:a]volume={vol},apad=whole_dur={dur:.3f},"
                                    f"atrim=duration={dur:.3f},asetpts=PTS-STARTPTS[amb]")
                        filt.append("[voce][amb]amix=inputs=2:duration=first:dropout_transition=0,"
                                    "aresample=44100[aout]")
                        amap = ["-map", "[aout]"]
                    else:
                        amap = ["-map", f"{ai}:a", "-af", voce_f]
                elif ambiente:
                    filt.append(f"[0:a]apad=whole_dur={dur:.3f},atrim=duration={dur:.3f},"
                                f"asetpts=PTS-STARTPTS,aresample=44100[aout]")
                    amap = ["-map", "[aout]"]
                    inputs += ["-f", "lavfi", "-t", f"{dur:.3f}", "-i", "anullsrc=r=44100:cl=stereo"]
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
                clock += dur - (XFADE if transitions else 0.0)

            if not segments:
                raise RuntimeError("nessuna scena montata")

            # unione: in dissolvenza incrociata, oppure attaccate di netto
            joined = tmp / "unito.mp4"
            if transitions and len(segments) > 1:
                inputs: list[str] = []
                for seg, _ in segments:
                    inputs += ["-i", str(seg)]
                vf, af = [], []
                ultimo_v, ultimo_a, off = "0:v", "0:a", 0.0
                for k in range(1, len(segments)):
                    off += segments[k - 1][1] - XFADE      # istante in cui comincia la dissolvenza
                    vf.append(f"[{ultimo_v}][{k}:v]xfade=transition=fade:duration={XFADE}"
                              f":offset={off:.3f}[vx{k}]")
                    af.append(f"[{ultimo_a}][{k}:a]acrossfade=d={XFADE}[ax{k}]")
                    ultimo_v, ultimo_a = f"vx{k}", f"ax{k}"
                code, out = await run([ff, "-y", *inputs, "-filter_complex", ";".join(vf + af),
                                       "-map", f"[{ultimo_v}]", "-map", f"[{ultimo_a}]",
                                       "-c:v", "libx264", "-preset", "veryfast", "-crf", "21",
                                       "-pix_fmt", "yuv420p", "-r", "30", "-c:a", "aac", "-b:a", "160k",
                                       str(joined)], tmp, 1200, self.log_path)
                if code != 0:
                    notes.append("Dissolvenze non riuscite: scene attaccate di netto.")
                    transitions = False
            if not transitions or len(segments) == 1 or not joined.is_file():
                lst = tmp / "scene.txt"
                lst.write_text("".join(f"file '{p.as_posix()}'\n" for p, _ in segments), encoding="utf-8")
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
            previsti = clock + (XFADE if transitions and len(segments) > 1 else 0.0)
            report.update({"path": str(out_path), "scenes_used": len(segments), "cues": len(cues),
                           "subtitles": subs, "planned_seconds": round(previsti, 2),
                           "measured": measured, "width": W, "height": H,
                           "size_bytes": out_path.stat().st_size})
            if measured.get("seconds") and abs(measured["seconds"] - previsti) > 1.0:
                notes.append(f"Durata misurata {measured['seconds']}s diversa da quella prevista {previsti:.1f}s.")
            return report
        finally:
            shutil.rmtree(tmp, ignore_errors=True)
