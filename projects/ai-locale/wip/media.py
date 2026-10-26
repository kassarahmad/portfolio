"""LAVORO IN CORSO - NON FA PARTE DELL'APPLICAZIONE.

Questo modulo NON viene importato da AI Locale: sta fuori da `backend/` apposta.
Serve alle milestone future M2 (immagini locali) e M3 (montaggio video con ffmpeg).

Prima di riattivarlo servono, nell'ordine:
  1. ffmpeg disponibile (binario di sistema) e `imageio-ffmpeg` in requirements.txt;
  2. stable-diffusion.cpp (`sd-cli`) in tools/sd/ e i modelli in models/image/ (circa 8 GB);
  3. collegamento reale: MediaStudio nei Services, passaggio di `media`/`voice` nel ToolContext
     dell'orchestratore, e un agente che abbia gli strumenti in lista.
Senza il punto 3 gli strumenti risultano registrati ma irraggiungibili: e' il difetto
corretto dalla milestone M0 del 26/10/2026.
"""
from __future__ import annotations

import asyncio
import contextlib
import logging
import math
import os
import re
import shutil
import subprocess
import time
import uuid
import wave
from pathlib import Path
from typing import Any, Awaitable, Callable

log = logging.getLogger("ailocale.media")

ASPECTS = {"9:16": (1080, 1920), "16:9": (1920, 1080), "1:1": (1080, 1080), "4:5": (1080, 1350)}
GEN_SIZES = {"9:16": (576, 1024), "16:9": (1024, 576), "1:1": (1024, 1024), "4:5": (832, 1024)}
WAN_NEGATIVE = ("blurry, low quality, static, distorted, deformed, watermark, text, subtitles, "
                "extra limbs, bad anatomy, overexposed, jpeg artifacts")


# ---------------------------------------------------------------------------
# Passaggio della GPU tra il modello linguistico e i generatori
# ---------------------------------------------------------------------------
class GpuGate:
    def __init__(self, stop_llm: Callable[[], Awaitable[bool]] | None = None,
                 start_llm: Callable[[], Awaitable[None]] | None = None,
                 llm_healthy: Callable[[], Awaitable[bool]] | None = None, ready_timeout: float = 240):
        self.stop_llm, self.start_llm, self.llm_healthy = stop_llm, start_llm, llm_healthy
        self.ready = asyncio.Event()
        self.ready.set()
        self.lock = asyncio.Lock()
        self.in_flight = 0
        self.ready_timeout = ready_timeout
        self.note = ""

    async def before_llm(self) -> None:
        if not self.ready.is_set():
            await asyncio.wait_for(self.ready.wait(), timeout=self.ready_timeout + 600)
        self.in_flight += 1

    def after_llm(self) -> None:
        self.in_flight = max(0, self.in_flight - 1)

    @contextlib.asynccontextmanager
    async def exclusive(self):
        """Libera la GPU dal modello linguistico per la durata del blocco."""
        async with self.lock:
            self.ready.clear()
            stopped = False
            try:
                for _ in range(1200):            # aspetta le chiamate in corso (max 2 minuti)
                    if self.in_flight == 0:
                        break
                    await asyncio.sleep(0.1)
                if self.stop_llm is not None:
                    stopped = await self.stop_llm()
                self.note = "" if stopped else ("Il modello linguistico non è gestito da AI Locale: la GPU è condivisa, "
                                                "la generazione sarà più lenta.")
                yield stopped
            finally:
                if stopped and self.start_llm is not None:
                    try:
                        await self.start_llm()
                        t0 = time.time()
                        while time.time() - t0 < self.ready_timeout:
                            if self.llm_healthy is None or await self.llm_healthy():
                                break
                            await asyncio.sleep(1.0)
                    except Exception:  # noqa: BLE001
                        log.exception("riavvio del modello linguistico non riuscito")
                self.ready.set()


# ---------------------------------------------------------------------------
# Utilità
# ---------------------------------------------------------------------------
def ffmpeg_exe() -> str | None:
    try:
        import imageio_ffmpeg
        return imageio_ffmpeg.get_ffmpeg_exe()
    except Exception:  # noqa: BLE001
        return shutil.which("ffmpeg")


def slug(text: str, n: int = 40) -> str:
    s = re.sub(r"[^a-z0-9]+", "-", (text or "").lower()).strip("-")[:n]
    return s or uuid.uuid4().hex[:8]


def font(size: int):
    from PIL import ImageFont
    candidates = [r"C:\Windows\Fonts\segoeuib.ttf", r"C:\Windows\Fonts\arialbd.ttf",
                  "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
                  "/System/Library/Fonts/Supplemental/Arial Bold.ttf"]
    for c in candidates:
        if os.path.exists(c):
            return ImageFont.truetype(c, size)
    try:
        return ImageFont.load_default(size=size)
    except TypeError:
        return ImageFont.load_default()


def wav_seconds(path: Path) -> float:
    with wave.open(str(path), "rb") as w:
        return w.getnframes() / float(w.getframerate() or 1)


def chunk_words(text: str, max_words: int = 5) -> list[str]:
    words = text.split()
    out, cur = [], []
    for w in words:
        cur.append(w)
        if len(cur) >= max_words or re.search(r"[.!?;:]$", w):
            out.append(" ".join(cur))
            cur = []
    if cur:
        out.append(" ".join(cur))
    return out or [""]


def cover(img, w: int, h: int):
    """Ritaglia e scala come CSS object-fit: cover."""
    from PIL import Image
    iw, ih = img.size
    scale = max(w / iw, h / ih)
    img = img.convert("RGB").resize((max(w, round(iw * scale)), max(h, round(ih * scale))), Image.LANCZOS)
    left = (img.width - w) // 2
    top = (img.height - h) // 2
    return img.crop((left, top, left + w, top + h))


def title_card(text: str, w: int, h: int, accent=(240, 180, 76)):
    """Sfondo di riserva quando non c'è un generatore di immagini: tinta calda e titolo grande."""
    from PIL import Image, ImageDraw
    img = Image.new("RGB", (w, h), (24, 22, 19))
    d = ImageDraw.Draw(img)
    d.rectangle([0, 0, w, int(h * 0.012)], fill=accent)
    f = font(int(w * 0.075))
    lines = wrap(text, f, int(w * 0.82), d)[:6]
    lh = int(w * 0.095)
    y = (h - lh * len(lines)) // 2
    for ln in lines:
        tw = d.textlength(ln, font=f)
        d.text(((w - tw) / 2, y), ln, font=f, fill=(237, 235, 228))
        y += lh
    return img


def wrap(text: str, f, max_w: int, draw) -> list[str]:
    words, lines, cur = text.split(), [], ""
    for w in words:
        test = (cur + " " + w).strip()
        if draw.textlength(test, font=f) <= max_w or not cur:
            cur = test
        else:
            lines.append(cur)
            cur = w
    if cur:
        lines.append(cur)
    return lines


def caption_png(text: str, w: int, h: int, path: Path) -> None:
    """Sottotitolo stile short: testo bianco grande con contorno, nel terzo inferiore."""
    from PIL import Image, ImageDraw
    img = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    size = int(min(w, h) * (0.075 if h > w else 0.055))
    f = font(size)
    lines = wrap(text, f, int(w * 0.84), d)[:3]
    lh = int(size * 1.22)
    y = int(h * (0.70 if h > w else 0.78)) - lh * len(lines) // 2
    for ln in lines:
        tw = d.textlength(ln, font=f)
        d.text(((w - tw) / 2, y), ln, font=f, fill=(255, 255, 255, 255),
               stroke_width=max(3, size // 12), stroke_fill=(0, 0, 0, 235))
        y += lh
    img.save(path)


async def run_proc(argv: list[str], cwd: Path, timeout: float, log_path: Path | None = None) -> tuple[int, str]:
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
                fh.write(f"\n$ {' '.join(argv)}\n{text[-20000:]}\n")
    return proc.returncode or 0, text


# ---------------------------------------------------------------------------
# Studio
# ---------------------------------------------------------------------------
class MediaStudio:
    def __init__(self, settings: Any, gate: GpuGate | None = None):
        self.settings = settings
        self.gate = gate or GpuGate()
        self.log_path = settings.data_dir / "logs" / "media.log"

    # -- configurazione ----------------------------------------------------------
    def sd_path(self) -> Path | None:
        explicit = os.environ.get("SD_CPP_PATH", "").strip()
        if explicit and Path(explicit).is_file():
            return Path(explicit)
        root = Path(__file__).resolve().parents[2] / "tools" / "sd"
        if root.is_dir():
            for name in ("sd-cli.exe", "sd.exe", "sd-cli", "sd"):
                found = sorted(root.rglob(name))
                if found:
                    return found[0]
        return None

    def _find(self, folder: str, patterns: list[str]) -> Path | None:
        d = self.settings.models_dir / folder
        if not d.is_dir():
            return None
        for pat in patterns:
            found = sorted(d.glob(pat))
            if found:
                return found[0]
        return None

    def image_model(self) -> dict | None:
        diff = self._find("image", ["z_image_turbo*.gguf", "z_image*.gguf", "z_image*.safetensors"])
        vae = self._find("image", ["ae.safetensors", "ae.sft"])
        llm = self._find("image", ["Qwen3-4B*.gguf", "qwen_3_4b*.safetensors"])
        if diff and vae and llm:
            return {"diffusion": diff, "vae": vae, "llm": llm, "name": diff.stem}
        return None

    def video_model(self) -> dict | None:
        diff = self._find("video", ["wan2.1_t2v_1.3B*.safetensors", "wan2.1*1.3B*.gguf", "wan*1.3B*"])
        vae = self._find("video", ["wan_2.1_vae*.safetensors"])
        t5 = self._find("video", ["umt5*.gguf", "umt5*.safetensors"])
        if diff and vae and t5:
            return {"diffusion": diff, "vae": vae, "t5": t5, "name": diff.stem}
        return None

    def status(self) -> dict:
        sd = self.sd_path()
        img, vid = self.image_model(), self.video_model()
        return {"engine": bool(sd), "engine_path": str(sd) if sd else None,
                "image": bool(sd and img), "image_model": img["name"] if img else None,
                "video": bool(sd and vid), "video_model": vid["name"] if vid else None,
                "ffmpeg": bool(ffmpeg_exe())}

    # -- immagini ----------------------------------------------------------------
    async def generate_images(self, jobs: list[dict], workdir: Path) -> list[Path]:
        """jobs: [{prompt, path, width, height, steps, seed}] - una sola sessione GPU per tutte."""
        sd, model = self.sd_path(), self.image_model()
        if not sd or not model:
            raise RuntimeError("Generatore di immagini non installato: esegui scripts\\media.ps1")
        out: list[Path] = []
        async with self.gate.exclusive():
            for j in jobs:
                path = Path(j["path"])
                path.parent.mkdir(parents=True, exist_ok=True)
                argv = [str(sd), "--diffusion-model", str(model["diffusion"]), "--vae", str(model["vae"]),
                        "--llm", str(model["llm"]), "-p", j["prompt"], "--cfg-scale", "1.0",
                        "--steps", str(j.get("steps") or 8), "-W", str(j.get("width") or 1024),
                        "-H", str(j.get("height") or 1024), "--seed", str(j.get("seed") if j.get("seed") is not None else -1),
                        "--diffusion-fa", "--offload-to-cpu", "-o", str(path)]
                code, text = await run_proc(argv, workdir, timeout=900, log_path=self.log_path)
                if code != 0 or not path.is_file():
                    raise RuntimeError(f"Generazione dell'immagine non riuscita (codice {code}). "
                                       f"Dettagli in data/logs/media.log. {text[-300:]}")
                out.append(path)
        return out

    # -- clip video generate (Wan) --------------------------------------------------
    async def generate_clip(self, prompt: str, path: Path, workdir: Path, seconds: float = 2.0,
                            landscape: bool = True) -> Path:
        sd, model, ff = self.sd_path(), self.video_model(), ffmpeg_exe()
        if not sd or not model:
            raise RuntimeError("Generatore video non installato: esegui scripts\\media.ps1 -Video")
        if not ff:
            raise RuntimeError("ffmpeg non disponibile: pip install imageio-ffmpeg")
        frames = int(min(81, max(17, round(seconds * 16)))) // 4 * 4 + 1   # Wan vuole 4n+1 fotogrammi
        w, h = (832, 480) if landscape else (480, 832)
        tmp = workdir / ".media" / uuid.uuid4().hex[:8]
        tmp.mkdir(parents=True, exist_ok=True)
        raw = tmp / "clip.avi"
        argv = [str(sd), "-M", "vid_gen", "--diffusion-model", str(model["diffusion"]), "--vae", str(model["vae"]),
                "--t5xxl", str(model["t5"]), "-p", prompt, "-n", WAN_NEGATIVE, "--cfg-scale", "6.0",
                "--sampling-method", "euler", "-W", str(w), "-H", str(h), "--diffusion-fa", "--offload-to-cpu",
                "--video-frames", str(frames), "--flow-shift", "3.0", "-o", str(raw)]
        async with self.gate.exclusive():
            code, text = await run_proc(argv, tmp, timeout=3600, log_path=self.log_path)
        produced = [p for p in tmp.iterdir() if p.is_file()]
        videos = [p for p in produced if p.suffix.lower() in (".avi", ".mp4", ".webm", ".mov", ".mkv")]
        pngs = sorted(p for p in produced if p.suffix.lower() == ".png")
        path.parent.mkdir(parents=True, exist_ok=True)
        if videos:
            src = ["-i", str(videos[0])]
        elif pngs:   # versioni che salvano i fotogrammi come immagini
            pattern = tmp / "frame_%05d.png"
            for i, p in enumerate(pngs):
                p.rename(tmp / f"frame_{i:05d}.png")
            src = ["-framerate", "16", "-i", str(pattern)]
        else:
            raise RuntimeError(f"Generazione video non riuscita (codice {code}). Dettagli in data/logs/media.log. "
                               f"{text[-300:]}")
        code, text = await run_proc([ff, "-y", *src, "-c:v", "libx264", "-preset", "veryfast", "-crf", "20",
                                     "-pix_fmt", "yuv420p", "-movflags", "+faststart", str(path)], tmp, 600)
        shutil.rmtree(tmp, ignore_errors=True)
        if code != 0 or not path.is_file():
            raise RuntimeError("Conversione della clip in MP4 non riuscita.")
        return path

    # -- video montati ------------------------------------------------------------
    async def make_video(self, *, scenes: list[dict], out_path: Path, workdir: Path, aspect: str = "9:16",
                         voice: Any = None, music: Path | None = None, title: str = "") -> dict:
        ff = ffmpeg_exe()
        if not ff:
            raise RuntimeError("ffmpeg non disponibile: esegui scripts\\media.ps1 (installa imageio-ffmpeg)")
        if not scenes:
            raise ValueError("servono delle scene")
        W, H = ASPECTS.get(aspect, ASPECTS["9:16"])
        gw, gh = GEN_SIZES.get(aspect, GEN_SIZES["9:16"])
        tmp = workdir / ".media" / uuid.uuid4().hex[:8]
        tmp.mkdir(parents=True, exist_ok=True)
        report: dict[str, Any] = {"scenes": len(scenes), "generated_images": 0, "generated_clips": 0,
                                  "voice": False, "notes": []}
        try:
            # 1) immagini mancanti: generate in un'unica sessione GPU, altrimenti cartoncini di riserva
            from PIL import Image
            jobs, plan = [], []
            for i, sc in enumerate(scenes):
                img = sc.get("image")
                if img and Path(img).is_file():
                    plan.append(("file", Path(img)))
                elif sc.get("clip_prompt"):
                    plan.append(("clip", sc["clip_prompt"]))
                elif sc.get("prompt"):
                    p = workdir / "immagini" / f"{slug(title or 'video')}-{i + 1:02d}.png"
                    jobs.append({"prompt": sc["prompt"], "path": str(p), "width": gw, "height": gh})
                    plan.append(("gen", p))
                else:
                    plan.append(("card", None))
            if jobs:
                if self.image_model() and self.sd_path():
                    await self.generate_images(jobs, workdir)
                    report["generated_images"] = len(jobs)
                else:
                    report["notes"].append("Generatore di immagini non installato: uso sfondi con il testo.")
                    plan = [("card", None) if k == "gen" else (k, v) for k, v in plan]
            clips: dict[int, Path] = {}
            for i, (kind, val) in enumerate(plan):
                if kind == "clip":
                    if self.video_model() and self.sd_path():
                        clips[i] = await self.generate_clip(val, tmp / f"clip{i}.mp4", workdir, seconds=3.0,
                                                            landscape=W >= H)
                        report["generated_clips"] += 1
                    else:
                        report["notes"].append("Generatore video non installato: scena con sfondo statico.")
                        plan[i] = ("card", None)

            # 2) voce per ogni scena (Piper), altrimenti durata in base alle parole
            seg_files = []
            for i, sc in enumerate(scenes):
                text = (sc.get("narration") or sc.get("text") or "").strip()
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
                        if not report["notes"] or "voce" not in report["notes"][-1]:
                            report["notes"].append(f"Voce non disponibile ({type(exc).__name__}): video senza parlato.")
                        audio = None
                dur = float(sc.get("seconds") or dur)

                # 3) sfondo della scena
                kind, val = plan[i]
                base = tmp / f"bg{i}.png"
                if kind in ("file", "gen"):
                    cover(Image.open(val), W, H).save(base)
                elif kind == "card":
                    title_card(text or title, W, H).save(base)

                # 4) sottotitoli a blocchi, tempi proporzionali alle parole
                parts = chunk_words(text) if text and sc.get("captions", True) else []
                total_w = sum(len(p.split()) for p in parts) or 1
                caps, t0 = [], 0.0
                for k, ptxt in enumerate(parts):
                    span = dur * len(ptxt.split()) / total_w
                    cp = tmp / f"cap{i}_{k}.png"
                    caption_png(ptxt, W, H, cp)
                    caps.append((cp, t0, t0 + span))
                    t0 += span

                # 5) montaggio della scena
                fps = 30
                frames = max(1, int(math.ceil(dur * fps)))
                inputs, filt = [], []
                if i in clips:
                    inputs += ["-stream_loop", "-1", "-i", str(clips[i])]
                    filt.append(f"[0:v]scale={W}:{H}:force_original_aspect_ratio=increase,crop={W}:{H},"
                                f"fps={fps},trim=duration={dur:.3f},setpts=PTS-STARTPTS[bg]")
                else:
                    inputs += ["-i", str(base)]
                    zoom_in = i % 2 == 0
                    z = f"1+0.10*on/{frames}" if zoom_in else f"1.10-0.10*on/{frames}"
                    filt.append(f"[0:v]scale={W * 2}:{H * 2},zoompan=z='{z}':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)'"
                                f":d={frames}:s={W}x{H}:fps={fps},trim=duration={dur:.3f},setpts=PTS-STARTPTS[bg]")
                last = "bg"
                for k, (cp, a, b) in enumerate(caps):
                    inputs += ["-i", str(cp)]
                    filt.append(f"[{last}][{k + 1}:v]overlay=0:0:enable='between(t,{a:.3f},{b:.3f})'[v{k}]")
                    last = f"v{k}"
                audio_idx = len(caps) + 1
                if audio is not None:
                    inputs += ["-i", str(audio)]
                    amap = ["-map", f"{audio_idx}:a", "-af", f"apad=whole_dur={dur:.3f}"]
                else:
                    inputs += ["-f", "lavfi", "-t", f"{dur:.3f}", "-i", "anullsrc=r=44100:cl=stereo"]
                    amap = ["-map", f"{audio_idx}:a"]
                seg = tmp / f"scena{i:02d}.mp4"
                argv = [ff, "-y", *inputs, "-filter_complex", ";".join(filt), "-map", f"[{last}]", *amap,
                        "-t", f"{dur:.3f}", "-c:v", "libx264", "-preset", "veryfast", "-crf", "21",
                        "-pix_fmt", "yuv420p", "-r", str(fps), "-c:a", "aac", "-b:a", "160k", "-ar", "44100",
                        "-ac", "2", str(seg)]
                code, text_out = await run_proc(argv, tmp, timeout=900, log_path=self.log_path)
                if code != 0 or not seg.is_file():
                    raise RuntimeError(f"Montaggio della scena {i + 1} non riuscito: {text_out[-400:]}")
                seg_files.append((seg, dur))

            # 6) unione delle scene (+ musica di sottofondo facoltativa)
            lst = tmp / "scene.txt"
            lst.write_text("".join(f"file '{p.as_posix()}'\n" for p, _ in seg_files), encoding="utf-8")
            out_path.parent.mkdir(parents=True, exist_ok=True)
            joined = tmp / "unito.mp4"
            code, text_out = await run_proc([ff, "-y", "-f", "concat", "-safe", "0", "-i", str(lst), "-c", "copy",
                                             str(joined)], tmp, timeout=600, log_path=self.log_path)
            if code != 0:
                raise RuntimeError(f"Unione delle scene non riuscita: {text_out[-400:]}")
            if music is not None and Path(music).is_file():
                code, text_out = await run_proc(
                    [ff, "-y", "-i", str(joined), "-stream_loop", "-1", "-i", str(music), "-filter_complex",
                     "[1:a]volume=0.12[m];[0:a][m]amix=inputs=2:duration=first:dropout_transition=0[a]",
                     "-map", "0:v", "-map", "[a]", "-c:v", "copy", "-c:a", "aac", "-b:a", "160k",
                     "-movflags", "+faststart", str(out_path)], tmp, timeout=600, log_path=self.log_path)
                if code != 0:
                    raise RuntimeError(f"Aggiunta della musica non riuscita: {text_out[-300:]}")
            else:
                code, _ = await run_proc([ff, "-y", "-i", str(joined), "-c", "copy", "-movflags", "+faststart",
                                          str(out_path)], tmp, timeout=300, log_path=self.log_path)
            total = sum(d for _, d in seg_files)
            report.update({"path": str(out_path), "seconds": round(total, 1), "width": W, "height": H,
                           "size_bytes": out_path.stat().st_size})
            return report
        finally:
            shutil.rmtree(tmp, ignore_errors=True)
