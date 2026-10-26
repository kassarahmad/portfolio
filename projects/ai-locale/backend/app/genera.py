"""Generazione locale di immagini e video con stable-diffusion.cpp.

Tutto sul PC: nessun servizio esterno, nessuna chiave, nessun costo. Il motore e'
un singolo eseguibile (`sd-cli`) che legge modelli GGUF dalla cartella models/gen.

Due attenzioni che questo modulo risolve e che altrimenti si pagano care:

1. La VRAM e' una sola. Il modello di chat ne occupa quasi tutta: prima di generare
   va scaricato e poi ricaricato, altrimenti la generazione va in errore o impiega
   dieci volte il tempo. Se ne occupa `GpuGate`.
2. Generare e' lento (minuti, non secondi). Ogni funzione dice in anticipo quanto
   ci vorra', e il processo ha un limite di tempo oltre il quale viene fermato.
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
import re
import subprocess
import time
import uuid
from dataclasses import dataclass
from pathlib import Path
from typing import Any

log = logging.getLogger("ailocale.genera")

# Dimensioni: multipli di 64, come vuole il modello.
IMAGE_SIZES = {"verticale": (768, 1344), "quadrato": (1024, 1024), "orizzontale": (1344, 768),
               "ritratto": (832, 1216), "9:16": (768, 1344), "1:1": (1024, 1024), "16:9": (1344, 768)}
VIDEO_SIZES = {"verticale": (480, 832), "orizzontale": (832, 480), "quadrato": (640, 640),
               "9:16": (480, 832), "16:9": (832, 480), "1:1": (640, 640)}

# Il negativo consigliato dagli autori di Wan: senza, i video vengono spenti e statici.
WAN_NEGATIVE = ("blurry, low quality, jpeg artifacts, overexposed, static, still picture, "
                "subtitles, watermark, text, ugly, deformed, extra fingers, bad hands, bad face, "
                "disfigured, cluttered background, walking backwards")

MAX_IMAGE_STEPS = 20
MAX_VIDEO_FRAMES = 121          # 5 secondi a 24 fps
IMAGE_TIMEOUT = 15 * 60
VIDEO_TIMEOUT = 90 * 60


@dataclass
class Modelli:
    """I file che servono, e quali mancano."""
    diffusion: Path | None = None
    vae: Path | None = None
    encoder: Path | None = None
    mancanti: list[str] = None  # type: ignore[assignment]

    @property
    def completo(self) -> bool:
        return not self.mancanti and all((self.diffusion, self.vae, self.encoder))


class GpuGate:
    """Libera la VRAM dal modello di chat per il tempo della generazione, poi lo rimette.

    Con LM Studio basta una chiamata HTTP; con llama-server gestito da AI Locale si
    ferma e si riavvia il processo. In entrambi i casi, se qualcosa va storto il
    modello di chat viene comunque rimesso com'era.
    """

    def __init__(self, settings: Any, chat_server: Any = None, http: Any = None):
        self.settings = settings
        self.chat_server = chat_server
        self._http = http
        self._rimettere: dict | None = None

    def _base(self) -> str:
        return re.sub(r"/v1/?$", "", (self.settings.llm_base_url or "").rstrip("/"))

    async def _client(self):
        if self._http is not None:
            return self._http
        from .llm import httpx          # stesso client del resto dell'applicazione
        return httpx.AsyncClient(timeout=httpx.Timeout(60, connect=5))

    async def libera(self) -> str:
        """Scarica il modello di chat. Restituisce una riga che dice cosa ha fatto."""
        # 1. llama-server avviato da noi: lo fermiamo noi
        srv = self.chat_server
        if srv is not None and getattr(srv, "running", lambda: False)():
            self._rimettere = {"tipo": "llama", "modello": getattr(srv, "model_file", None)}
            await srv.stop()
            return "llama-server fermato per liberare la VRAM"
        # 2. LM Studio: glielo chiediamo via API
        try:
            c = await self._client()
            r = await c.get(f"{self._base()}/api/v1/models")
            if r.status_code == 200:
                caricati = [m for m in (r.json().get("data") or [])
                            if m.get("state") in ("loaded", "ready") or m.get("loaded")]
                if caricati:
                    self._rimettere = {"tipo": "lmstudio", "modelli": [m.get("id") or m.get("key")
                                                                      for m in caricati]}
                    for m in self._rimettere["modelli"]:
                        await c.post(f"{self._base()}/api/v1/models/unload", json={"model": m})
                    return f"modelli scaricati da LM Studio: {', '.join(self._rimettere['modelli'])}"
        except Exception as exc:  # noqa: BLE001
            log.warning("non sono riuscito a liberare la VRAM (%s): genero lo stesso", exc)
        return "VRAM non liberata: la generazione potrebbe essere piu' lenta"

    async def rimetti(self) -> None:
        """Rimette il modello di chat com'era. Non solleva mai: e' una pulizia."""
        stato, self._rimettere = self._rimettere, None
        if not stato:
            return
        try:
            if stato["tipo"] == "llama" and self.chat_server is not None and stato.get("modello"):
                await self.chat_server.start(stato["modello"])
            elif stato["tipo"] == "lmstudio":
                c = await self._client()
                for m in stato.get("modelli", []):
                    await c.post(f"{self._base()}/api/v1/models/load", json={"model": m})
        except Exception:  # noqa: BLE001
            log.exception("non sono riuscito a rimettere il modello di chat: riavvialo dal pannello")


class Studio:
    """Immagini e video generati in locale."""

    def __init__(self, settings: Any, chat_server: Any = None):
        self.settings = settings
        self.gate = GpuGate(settings, chat_server)
        self.log_path = settings.data_dir / "logs" / "genera.log"
        self._lock = asyncio.Lock()      # una generazione per volta: la GPU e' una

    # -- dove sono le cose ---------------------------------------------------
    def _sd_dir(self) -> Path:
        return self.settings.models_dir.parent / "tools" / "sd"

    def wsl_bin(self) -> str | None:
        """Percorso Linux del motore, scritto da scripts/wsl-genera.sh.

        Su Windows con Smart App Control attivo il motore non puo' girare nativamente
        (rifiuta le DLL non firmate), quindi gira dentro WSL2 e lo si chiama con
        wsl.exe, che e' firmato Microsoft.
        """
        f = self._sd_dir() / "wsl-path.txt"
        if not f.is_file():
            return None
        try:
            riga = f.read_text(encoding="utf-8").strip().splitlines()[0].strip()
        except (OSError, IndexError):
            return None
        return riga or None

    def exe(self) -> Path | None:
        """Motore nativo, quando c'e'. In modalita' WSL vale wsl_bin()."""
        for nome in ("sd-cli.exe", "sd-cli", "sd.exe", "sd"):
            p = self._sd_dir() / nome
            if p.is_file():
                return p
        return None

    def disponibile(self) -> bool:
        return bool(self.wsl_bin() or self.exe())

    # -- come si chiama il motore -------------------------------------------
    @staticmethod
    def to_wsl(p: Path | str) -> str:
        """C:\\Users\\x -> /mnt/c/Users/x; un percorso gia' Linux resta com'e'."""
        testo = str(p).replace("\\", "/")
        m = re.match(r"^([A-Za-z]):/(.*)$", testo)
        return f"/mnt/{m.group(1).lower()}/{m.group(2)}" if m else testo

    def _lancio(self) -> tuple[list[str], Any]:
        """Prefisso del comando e funzione che traduce i percorsi."""
        linux = self.wsl_bin()
        if linux:
            return ["wsl.exe", "-e", linux], self.to_wsl
        exe = self.exe()
        if exe:
            return [str(exe)], str
        raise RuntimeError(self.status()["hint"])

    def _gen_dir(self) -> Path:
        return self.settings.models_dir / "gen"

    def _trova(self, cartella: str, *pezzi: str, senza: tuple[str, ...] = ()) -> Path | None:
        """Primo file della cartella che contiene tutti i `pezzi` e nessuno di `senza`.

        `senza` serve davvero: cercando "ae." per il VAE delle immagini si trova anche
        wan2.2_vae.safetensors, perche' "ae." e' dentro "vae.".
        """
        base = self._gen_dir() / cartella
        if not base.is_dir():
            return None
        for f in sorted(base.iterdir()):
            nome = f.name.lower()
            if not f.is_file() or any(x.lower() in nome for x in senza):
                continue
            if all(p.lower() in nome for p in pezzi):
                return f
        return None

    def modelli(self, tipo: str) -> Modelli:
        if tipo == "immagine":
            m = Modelli(self._trova("diffusion", "z_image"),
                        self._trova("vae", "ae.", senza=("wan", "_vae")),
                        self._trova("encoder", "qwen3-4b"))
            attesi = {"modello immagini (z_image_turbo)": m.diffusion,
                      "VAE (ae.safetensors)": m.vae,
                      "encoder di testo (Qwen3-4B)": m.encoder}
        else:
            m = Modelli(self._trova("diffusion", "wan2.2"), self._trova("vae", "wan2.2_vae"),
                        self._trova("encoder", "umt5"))
            attesi = {"modello video (Wan2.2-TI2V-5B)": m.diffusion,
                      "VAE (wan2.2_vae)": m.vae,
                      "encoder di testo (umt5-xxl)": m.encoder}
        m.mancanti = [k for k, v in attesi.items() if v is None]
        return m

    def status(self) -> dict:
        linux = self.wsl_bin()
        exe = self.exe()
        img, vid = self.modelli("immagine"), self.modelli("video")
        suggerimento = None
        if not (linux or exe):
            suggerimento = ("Motore non installato: lancia INSTALLA-GENERAZIONE.bat "
                            "(scarica stable-diffusion.cpp e i modelli, circa 16 GB).")
        elif not img.completo or not vid.completo:
            quali = []
            if not img.completo:
                quali.append("immagini (" + ", ".join(img.mancanti) + ")")
            if not vid.completo:
                quali.append("video (" + ", ".join(vid.mancanti) + ")")
            suggerimento = ("Mancano dei modelli per " + " e per ".join(quali) +
                            ". Rilancia INSTALLA-GENERAZIONE.bat: riprende da dove era rimasto.")
        return {"engine": bool(linux or exe), "engine_path": linux or (str(exe) if exe else None),
                "mode": "wsl" if linux else ("nativo" if exe else None),
                "images": img.completo, "videos": vid.completo,
                "missing_images": img.mancanti, "missing_videos": vid.mancanti,
                "hint": suggerimento}

    # -- esecuzione ----------------------------------------------------------
    async def _esegui(self, argv: list[str], timeout: float) -> tuple[int, str]:
        flags = subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0  # type: ignore[attr-defined]
        proc = await asyncio.create_subprocess_exec(*argv, cwd=str(self._gen_dir()),
                                                    stdout=asyncio.subprocess.PIPE,
                                                    stderr=asyncio.subprocess.STDOUT,
                                                    creationflags=flags)
        try:
            out, _ = await asyncio.wait_for(proc.communicate(), timeout=timeout)
        except asyncio.TimeoutError:
            proc.kill()
            await proc.wait()
            return -1, f"interrotto dopo {int(timeout / 60)} minuti"
        testo = (out or b"").decode("utf-8", errors="replace")
        try:
            self.log_path.parent.mkdir(parents=True, exist_ok=True)
            with self.log_path.open("a", encoding="utf-8") as fh:
                fh.write(f"\n$ {' '.join(argv)}\n{testo[-8000:]}\n")
        except OSError:
            pass
        return proc.returncode or 0, testo

    async def immagine(self, *, prompt: str, out_path: Path, size: str = "verticale",
                       steps: int = 8, seed: int = -1, negative: str = "") -> dict:
        base, P = self._lancio()
        m = self.modelli("immagine")
        if not m.completo:
            raise RuntimeError(f"Mancano dei file: {', '.join(m.mancanti)}. "
                               "Rilancia INSTALLA-GENERAZIONE.bat.")
        W, H = IMAGE_SIZES.get(size, IMAGE_SIZES["verticale"])
        steps = max(1, min(int(steps), MAX_IMAGE_STEPS))
        out_path.parent.mkdir(parents=True, exist_ok=True)
        argv = [*base, "--diffusion-model", P(m.diffusion), "--vae", P(m.vae),
                "--llm", P(m.encoder), "-p", prompt, "--cfg-scale", "1.0", "--steps", str(steps),
                "-W", str(W), "-H", str(H), "--offload-to-cpu", "--diffusion-fa",
                "-o", P(out_path), "-v"]
        if negative:
            argv += ["-n", negative]
        if seed >= 0:
            argv += ["-s", str(seed)]

        async with self._lock:
            liberata = await self.gate.libera()
            inizio = time.perf_counter()
            try:
                code, testo = await self._esegui(argv, IMAGE_TIMEOUT)
            finally:
                await self.gate.rimetti()
        durata = round(time.perf_counter() - inizio, 1)
        if code != 0 or not out_path.is_file():
            raise RuntimeError(f"generazione non riuscita ({testo.strip()[-400:] or 'nessun output'})")
        return {"path": str(out_path), "width": W, "height": H, "steps": steps,
                "seconds": durata, "size_bytes": out_path.stat().st_size, "vram": liberata}

    async def clip(self, *, prompt: str, out_path: Path, size: str = "verticale",
                   frames: int = 49, steps: int = 20, seed: int = -1,
                   image: Path | None = None) -> dict:
        """Genera uno spezzone video. Con `image` lo anima a partire da una foto."""
        base, P = self._lancio()
        m = self.modelli("video")
        if not m.completo:
            raise RuntimeError(f"Mancano dei file: {', '.join(m.mancanti)}. "
                               "Rilancia INSTALLA-GENERAZIONE.bat.")
        W, H = VIDEO_SIZES.get(size, VIDEO_SIZES["verticale"])
        # Il modello vuole 4n+1 fotogrammi: 33 = 1.4 s, 49 = 2 s, 81 = 3.4 s a 24 fps.
        frames = max(5, min(int(frames), MAX_VIDEO_FRAMES))
        frames = frames - ((frames - 1) % 4)
        out_path.parent.mkdir(parents=True, exist_ok=True)
        argv = [*base, "-M", "vid_gen", "--diffusion-model", P(m.diffusion),
                "--vae", P(m.vae), "--t5xxl", P(m.encoder), "-p", prompt,
                "-n", WAN_NEGATIVE, "--cfg-scale", "6.0", "--sampling-method", "euler",
                "--steps", str(max(1, min(int(steps), 40))), "-W", str(W), "-H", str(H),
                "--offload-to-cpu", "--video-frames", str(frames), "--flow-shift", "3.0",
                "-o", P(out_path), "-v"]
        if image is not None:
            argv += ["-i", P(image)]

        async with self._lock:
            liberata = await self.gate.libera()
            inizio = time.perf_counter()
            try:
                code, testo = await self._esegui(argv, VIDEO_TIMEOUT)
            finally:
                await self.gate.rimetti()
        durata = round(time.perf_counter() - inizio, 1)
        if code != 0 or not out_path.is_file():
            raise RuntimeError(f"generazione non riuscita ({testo.strip()[-400:] or 'nessun output'})")
        return {"path": str(out_path), "width": W, "height": H, "frames": frames,
                "video_seconds": round(frames / 24, 1), "seconds": durata,
                "size_bytes": out_path.stat().st_size, "vram": liberata,
                "from_image": str(image) if image else None}
