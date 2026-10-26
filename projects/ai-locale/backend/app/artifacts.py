"""Artefatti: i file che gli agenti producono durante un'esecuzione.

Dopo ogni esecuzione si registrano i file creati o modificati nella cartella di lavoro
(e quelli scritti con write_file altrove, nelle cartelle autorizzate). L'interfaccia li
mostra come prodotti di lavoro: documenti, codice, pagine HTML, dati, immagini, archivi.
"""
from __future__ import annotations

import csv
import io
import os
import zipfile
from pathlib import Path
from typing import Any

SKIP_DIRS = {".venv", "venv", "node_modules", "__pycache__", ".git", ".runs", ".pytest_cache", ".mypy_cache",
             "dist", "build", ".next", ".cache"}
MAX_SCAN = 4000          # file esaminati al massimo per esecuzione
MAX_ARTIFACTS = 60       # artefatti registrati al massimo per esecuzione
MAX_TEXT = 400_000       # byte di testo restituiti all'anteprima

KINDS: dict[str, str] = {}
for _ext in (".md", ".markdown", ".txt", ".rst", ".docx", ".odt", ".rtf"):
    KINDS[_ext] = "document"
for _ext in (".py", ".js", ".mjs", ".cjs", ".ts", ".tsx", ".jsx", ".css", ".scss", ".json", ".yaml", ".yml", ".toml",
             ".ini", ".cfg", ".sql", ".sh", ".ps1", ".bat", ".java", ".kt", ".c", ".h", ".cpp", ".hpp", ".cs", ".go",
             ".rs", ".rb", ".php", ".swift", ".xml", ".vue", ".svelte", ".dockerfile", ".env.example", ".gitignore"):
    KINDS[_ext] = "code"
for _ext in (".html", ".htm"):
    KINDS[_ext] = "html"
for _ext in (".csv", ".tsv", ".xlsx", ".xls"):
    KINDS[_ext] = "data"
for _ext in (".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".bmp"):
    KINDS[_ext] = "image"
KINDS[".pdf"] = "pdf"
for _ext in (".mp4", ".webm", ".mov", ".mkv"):
    KINDS[_ext] = "video"
for _ext in (".mp3", ".wav", ".m4a", ".ogg", ".flac"):
    KINDS[_ext] = "audio"
for _ext in (".srt", ".vtt"):
    KINDS[_ext] = "subtitles"
for _ext in (".pptx",):
    KINDS[_ext] = "slides"
for _ext in (".zip", ".tar", ".gz", ".tgz", ".7z", ".rar", ".tbz2", ".txz"):
    KINDS[_ext] = "archive"

LANGS = {".py": "python", ".js": "javascript", ".mjs": "javascript", ".cjs": "javascript", ".ts": "typescript",
         ".tsx": "typescript", ".jsx": "javascript", ".css": "css", ".scss": "css", ".json": "json", ".yaml": "yaml",
         ".yml": "yaml", ".toml": "toml", ".sql": "sql", ".sh": "shell", ".ps1": "powershell", ".bat": "shell",
         ".html": "html", ".htm": "html", ".xml": "html", ".vue": "html", ".java": "java", ".c": "c", ".cpp": "c",
         ".h": "c", ".cs": "c", ".go": "go", ".rs": "rust", ".php": "php", ".rb": "ruby", ".kt": "java",
         ".swift": "swift", ".md": "markdown"}

MIME = {".html": "text/html; charset=utf-8", ".htm": "text/html; charset=utf-8", ".svg": "image/svg+xml",
        ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif", ".webp": "image/webp",
        ".bmp": "image/bmp", ".pdf": "application/pdf", ".css": "text/plain; charset=utf-8",
        ".js": "text/plain; charset=utf-8", ".json": "application/json", ".csv": "text/plain; charset=utf-8",
        ".zip": "application/zip", ".mp4": "video/mp4", ".webm": "video/webm", ".mov": "video/quicktime",
        ".mp3": "audio/mpeg", ".wav": "audio/wav", ".m4a": "audio/mp4", ".ogg": "audio/ogg",
        ".srt": "text/plain; charset=utf-8", ".vtt": "text/vtt; charset=utf-8"}


def project_dir(workspace: Path, project: dict) -> Path:
    """Cartella di lavoro di un progetto, dentro la cartella di lavoro generale."""
    import re
    slug = re.sub(r"[^a-z0-9]+", "-", project["name"].lower()).strip("-")[:40] or "progetto"
    return workspace / "progetti" / f"{slug}-{project['id'][:6]}"


def project_collection(project_id: str) -> str:
    return f"prj-{project_id}"


def kind_of(path: Path) -> str:
    name = path.name.lower()
    if name == "dockerfile":
        return "code"
    for ext, kind in KINDS.items():
        if name.endswith(ext):
            return kind
    return "other"


def is_inside(path: Path, roots: list[Path]) -> bool:
    try:
        p = path.resolve()
    except OSError:
        return False
    return any(p == r or r in p.parents for r in roots)


def scan_changed(base: Path, since: float, extra: set[str] | None = None) -> list[Path]:
    """File creati o modificati in `base` dopo `since` (più quelli in `extra`)."""
    found: list[Path] = []
    seen = 0
    if base.is_dir():
        for root, dirs, files in os.walk(base):
            dirs[:] = [d for d in dirs if d not in SKIP_DIRS and not d.startswith(".")]
            for f in files:
                seen += 1
                if seen > MAX_SCAN:
                    break
                p = Path(root) / f
                try:
                    if p.stat().st_mtime >= since - 1:
                        found.append(p)
                except OSError:
                    continue
            if seen > MAX_SCAN:
                break
    for e in extra or ():
        p = Path(e)
        if p.is_file() and p not in found:
            found.append(p)
    found.sort(key=lambda p: (kind_of(p) == "other", -p.stat().st_mtime if p.exists() else 0))
    return found[:MAX_ARTIFACTS]


def title_for(path: Path, base: Path) -> str:
    try:
        rel = path.resolve().relative_to(base.resolve()).as_posix()
    except ValueError:
        rel = path.name
    return rel


def preview(path: Path, kind: str, read_document: Any = None) -> dict:
    """Contenuto per il visualizzatore, a seconda del tipo."""
    ext = path.suffix.lower()
    out: dict[str, Any] = {"kind": kind, "lang": LANGS.get(ext, ""), "ext": ext}
    if kind in ("document", "code", "html") and ext not in (".docx", ".odt", ".rtf"):
        data = path.read_bytes()[:MAX_TEXT]
        out["text"] = data.decode("utf-8", errors="replace")
        out["truncated"] = path.stat().st_size > MAX_TEXT
        return out
    if kind == "data" and ext in (".csv", ".tsv"):
        text = path.read_bytes()[:MAX_TEXT].decode("utf-8-sig", errors="replace")
        try:
            dialect = csv.Sniffer().sniff(text[:4000], delimiters=",;\t|")
        except csv.Error:
            dialect = csv.excel_tab if ext == ".tsv" else csv.excel
        rows = []
        for i, row in enumerate(csv.reader(io.StringIO(text), dialect)):
            if i >= 501:
                break
            rows.append(row[:40])
        out["rows"] = rows
        out["truncated"] = len(rows) > 500
        return out
    if kind == "archive" and ext == ".zip":
        try:
            with zipfile.ZipFile(path) as z:
                out["entries"] = [{"name": i.filename, "size": i.file_size} for i in z.infolist()[:500]]
        except zipfile.BadZipFile:
            out["error"] = "zip non valido"
        return out
    if kind == "subtitles":
        out["text"] = path.read_bytes()[:MAX_TEXT].decode("utf-8", errors="replace")
        return out
    if kind in ("image", "pdf", "video", "audio"):
        return out  # il browser lo mostra o lo riproduce dall'URL del file
    if read_document is not None and kind in ("document", "data", "slides"):
        out["text"] = read_document(path)[:MAX_TEXT]
        out["converted"] = True
        return out
    return out
