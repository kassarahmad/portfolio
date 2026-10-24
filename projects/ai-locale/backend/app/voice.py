"""Voce locale: trascrizione (faster-whisper) e sintesi vocale (Piper). Tutto sul PC.

Entrambi sono facoltativi: se le librerie o i modelli mancano, l'interfaccia lo dice e usa
le voci locali del sistema operativo per leggere le risposte.
"""
from __future__ import annotations

import asyncio
import io
import logging
import os
import re
import threading
import wave
from pathlib import Path
from typing import Any

log = logging.getLogger("ailocale.voice")

MAX_AUDIO = 15 * 1024 * 1024   # ~ 10 minuti di audio compresso
MAX_SPEAK = 4000               # caratteri letti ad alta voce per volta


def speakable(text: str) -> str:
    """Testo adatto alla lettura: niente codice, tabelle, link e simboli Markdown."""
    t = re.sub(r"```[\s\S]*?```", " (codice nella chat) ", text or "")
    t = re.sub(r"^\s*\|.*\|\s*$", "", t, flags=re.M)
    t = re.sub(r"!\[[^\]]*\]\([^)]*\)", "", t)
    t = re.sub(r"\[([^\]]+)\]\((https?://[^)]+)\)", r"\1", t)
    t = re.sub(r"https?://\S+", "", t)
    t = re.sub(r"`([^`]*)`", r"\1", t)
    t = re.sub(r"^#{1,6}\s*", "", t, flags=re.M)
    t = re.sub(r"^\s*[-*+]\s+", "", t, flags=re.M)
    t = re.sub(r"[*_~>#]+", "", t)
    t = re.sub(r"\n{2,}", ". ", t)
    t = re.sub(r"\s+", " ", t).strip()
    return t[:MAX_SPEAK]


class Voice:
    def __init__(self, settings: Any):
        self.settings = settings
        self.stt_model_name = os.environ.get("VOICE_STT_MODEL", "small")
        self.stt_device = os.environ.get("VOICE_STT_DEVICE", "cpu")   # la GPU resta al modello linguistico
        self._stt = None
        self._tts = None
        self._lock = threading.Lock()

    # -- disponibilità ---------------------------------------------------------
    @staticmethod
    def _has(module: str) -> bool:
        import importlib.util
        return importlib.util.find_spec(module) is not None

    def tts_model_path(self) -> Path | None:
        explicit = os.environ.get("VOICE_TTS_MODEL", "").strip()
        if explicit:
            p = Path(explicit)
            if not p.is_absolute():
                p = self.settings.models_dir / "voices" / p
            return p if p.is_file() else None
        folder = self.settings.models_dir / "voices"
        found = sorted(folder.glob("*.onnx")) if folder.is_dir() else []
        return found[0] if found else None

    def status(self) -> dict:
        stt = self._has("faster_whisper")
        tts_lib = self._has("piper")
        tts_model = self.tts_model_path()
        return {
            "stt": stt, "stt_model": self.stt_model_name if stt else None,
            "tts": bool(tts_lib and tts_model), "tts_voice": tts_model.stem if tts_model and tts_lib else None,
            "hint_stt": None if stt else "Installa la trascrizione: .venv\\Scripts\\pip install faster-whisper",
            "hint_tts": None if (tts_lib and tts_model) else
            "Per una voce naturale: pip install piper-tts e una voce .onnx in models\\voices (setup.ps1 lo fa).",
        }

    # -- trascrizione ----------------------------------------------------------
    def _load_stt(self):
        if self._stt is None:
            from faster_whisper import WhisperModel
            log.info("carico il modello di trascrizione %s (%s)", self.stt_model_name, self.stt_device)
            self._stt = WhisperModel(self.stt_model_name, device=self.stt_device,
                                     compute_type="int8" if self.stt_device == "cpu" else "float16")
        return self._stt

    def _transcribe_sync(self, audio: bytes, language: str | None) -> dict:
        with self._lock:
            model = self._load_stt()
            segments, info = model.transcribe(io.BytesIO(audio), language=language or None, beam_size=1,
                                              vad_filter=True, condition_on_previous_text=False)
            text = " ".join(s.text.strip() for s in segments).strip()
        return {"text": text, "language": getattr(info, "language", language),
                "duration": round(float(getattr(info, "duration", 0.0)), 2)}

    async def transcribe(self, audio: bytes, language: str | None = None) -> dict:
        if not self._has("faster_whisper"):
            raise RuntimeError("trascrizione non installata")
        return await asyncio.to_thread(self._transcribe_sync, audio, language)

    # -- sintesi ---------------------------------------------------------------
    def _load_tts(self):
        if self._tts is None:
            from piper import PiperVoice
            path = self.tts_model_path()
            if path is None:
                raise RuntimeError("nessuna voce Piper in models/voices")
            log.info("carico la voce %s", path.name)
            self._tts = PiperVoice.load(str(path))
        return self._tts

    def _speak_sync(self, text: str) -> bytes:
        with self._lock:
            voice = self._load_tts()
            buf = io.BytesIO()
            with wave.open(buf, "wb") as wav:
                if hasattr(voice, "synthesize_wav"):      # piper-tts >= 1.3
                    voice.synthesize_wav(text, wav)
                else:                                      # versioni precedenti
                    voice.synthesize(text, wav)
            return buf.getvalue()

    async def speak(self, text: str) -> bytes:
        clean = speakable(text)
        if not clean:
            raise ValueError("niente da leggere")
        return await asyncio.to_thread(self._speak_sync, clean)
