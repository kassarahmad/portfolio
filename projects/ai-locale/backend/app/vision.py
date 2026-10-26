"""Visione e OCR.

- Analisi immagini con un modello multimodale (es. Qwen3-VL su llama-server con --mmproj).
- OCR: Tesseract se installato (veloce, preciso sul testo stampato), altrimenti il
  modello di visione legge la pagina. La funzione è dichiarata disponibile solo se
  uno dei due motori risponde davvero.
"""
from __future__ import annotations

import base64
import io
import logging
import shutil
import time
from typing import Any

from .llm import LLMError

log = logging.getLogger("ailocale.vision")

IMAGE_MAGIC = {b"\x89PNG": "image/png", b"\xff\xd8\xff": "image/jpeg", b"GIF8": "image/gif", b"RIFF": "image/webp"}
IMAGE_EXT = {".png", ".jpg", ".jpeg", ".webp", ".gif"}


class VisionError(Exception):
    pass


def sniff_image(data: bytes) -> str | None:
    for magic, mime in IMAGE_MAGIC.items():
        if data.startswith(magic):
            if mime == "image/webp" and data[8:12] != b"WEBP":
                return None
            return mime
    return None


def prepare_image(data: bytes, max_side: int = 1600) -> tuple[bytes, str]:
    """Ridimensiona immagini grandi (meno token, meno VRAM) e converte in PNG/JPEG."""
    mime = sniff_image(data)
    if not mime:
        raise VisionError("Il file non è un'immagine supportata (PNG, JPEG, WEBP, GIF).")
    try:
        from PIL import Image
    except ImportError:
        return data, mime
    img = Image.open(io.BytesIO(data))
    img.load()
    if img.mode not in ("RGB", "L"):
        img = img.convert("RGB")
    if max(img.size) > max_side:
        img.thumbnail((max_side, max_side))
    out = io.BytesIO()
    img.save(out, format="JPEG", quality=88)
    return out.getvalue(), "image/jpeg"


def tesseract_available() -> bool:
    try:
        import pytesseract  # noqa: F401
    except ImportError:
        return False
    return shutil.which("tesseract") is not None or bool(_tesseract_windows_path())


def _tesseract_windows_path() -> str | None:
    for p in (r"C:\Program Files\Tesseract-OCR\tesseract.exe", r"C:\Program Files (x86)\Tesseract-OCR\tesseract.exe"):
        try:
            from pathlib import Path
            if Path(p).exists():
                return p
        except OSError:
            pass
    return None


class Vision:
    def __init__(self, client: Any, router: Any = None):
        self.client = client  # LLMClient del modello multimodale
        self.router = router
        self._cap: tuple[float, bool] | None = None

    async def available(self) -> bool:
        """Vero solo se il server dichiara la modalità visione (llama-server /props) o la configurazione lo forza."""
        if self.client is None:
            return False
        if self._cap and time.time() - self._cap[0] < 30:
            return self._cap[1]
        ok = False
        try:
            h = await self.client.health()
            ok = bool(h.get("ok") and (h.get("vision") or getattr(self.client, "force_vision", False)))
        except Exception:  # noqa: BLE001
            ok = False
        self._cap = (time.time(), ok)
        return ok

    async def describe(self, data: bytes, question: str, max_tokens: int = 1200) -> str:
        if not await self.available():
            raise VisionError("Nessun modello di visione attivo. Carica un modello multimodale (es. Qwen3-VL) "
                              "con il suo file mmproj: vedi README, sezione Visione.")
        img, mime = prepare_image(data)
        url = f"data:{mime};base64,{base64.b64encode(img).decode()}"
        messages = [
            {"role": "system", "content": "You are a precise vision assistant. Describe only what is actually "
                                          "visible; say when something is unreadable or uncertain. Reply in the "
                                          "language of the question."},
            {"role": "user", "content": [{"type": "text", "text": question or "Describe this image in detail."},
                                         {"type": "image_url", "image_url": {"url": url}}]},
        ]
        try:
            r = await self.client.chat(messages, temperature=0.2, max_tokens=max_tokens)
        except LLMError as exc:
            raise VisionError(str(exc)) from exc
        return r.content

    # -- OCR ------------------------------------------------------------------
    async def ocr_available(self) -> str | None:
        if tesseract_available():
            return "tesseract"
        if await self.available():
            return "vision"
        return None

    async def ocr_image(self, data: bytes) -> str:
        engine = await self.ocr_available()
        if engine == "tesseract":
            import asyncio

            import pytesseract
            from PIL import Image
            win = _tesseract_windows_path()
            if win:
                pytesseract.pytesseract.tesseract_cmd = win
            img = Image.open(io.BytesIO(data))
            langs = pytesseract.get_languages(config="")
            lang = "+".join(x for x in ("ita", "eng") if x in langs) or "eng"
            return await asyncio.to_thread(pytesseract.image_to_string, img, lang=lang)
        if engine == "vision":
            return await self.describe(data, "Transcribe ALL the text in this image exactly, preserving the "
                                             "reading order and line breaks. Output only the text.", 3000)
        raise VisionError("OCR non disponibile: installa Tesseract OCR oppure attiva un modello di visione.")


def render_pdf_page(path: str, index: int, scale: float = 2.0) -> bytes:
    import pypdfium2 as pdfium
    pdf = pdfium.PdfDocument(path)
    try:
        page = pdf[index]
        img = page.render(scale=scale).to_pil()
        out = io.BytesIO()
        img.save(out, format="PNG")
        return out.getvalue()
    finally:
        pdf.close()
