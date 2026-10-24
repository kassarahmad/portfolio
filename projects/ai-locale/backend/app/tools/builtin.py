"""Strumenti degli agenti.

Livelli di rischio (mostrati nella pagina Strumenti):
  read      lettura non distruttiva
  write     crea/modifica file (sovrascritture, spostamenti, eliminazioni => approvazione)
  exec      esecuzione di codice o comandi => SEMPRE approvazione
  network   legge dal web (query e URL escono dal PC; disattivabile nelle Impostazioni)
  external  azioni con effetti fuori dal PC (invio moduli) => SEMPRE approvazione

Regole:
- i file sono accessibili solo nella cartella di lavoro e nelle cartelle autorizzate
  (AILOCALE_ALLOWED_PATHS); prima di sovrascrivere si salva una copia di backup;
  "eliminare" significa spostare nel cestino di AI Locale;
- alcuni comandi distruttivi sono bloccati anche se approvati;
- nessuno strumento può concedere nuovi permessi: le approvazioni le dà solo l'utente.
"""
from __future__ import annotations

import asyncio
import csv
import io
import os
import re
import shutil
import subprocess
import sys
import time
import uuid
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Awaitable, Callable

from .registry import Tool, ToolError, ToolRegistry, obj

MAX_OUTPUT = 6000
MAX_READ = 12000
TEXT_SKIP_DIRS = {".git", "node_modules", "__pycache__", ".venv", "venv", "dist", "build", ".runs"}


@dataclass
class ToolContext:
    settings: Any
    db: Any
    rag: Any
    agent: str
    run: Any  # RunContext
    consult: Callable[[str, str, str], Awaitable[str]]
    approve: Callable[[str, str], Awaitable[bool]] | None = None  # (strumento, anteprima) -> approvato?
    web: Any = None
    browser: Any = None
    vision: Any = None


# ---------------------------------------------------------------------------
# Percorsi
# ---------------------------------------------------------------------------
def safe_path(base: Path, rel: str, roots: list[Path] | None = None) -> Path:
    """Risolve un percorso: relativo => dentro `base`; assoluto => solo dentro una cartella autorizzata."""
    base = base.resolve()
    roots = [r.resolve() for r in (roots or [])] or [base]
    raw = (rel or ".").strip()
    is_abs = raw.startswith(("/", "\\")) or bool(re.match(r"^[a-zA-Z]:", raw))
    if is_abs and len(roots) == 1 and roots[0] == base:
        raise ToolError("Usa percorsi relativi alla cartella di lavoro.")
    target = Path(raw).expanduser().resolve() if is_abs else (base / raw.replace("\\", "/")).resolve()
    for root in roots:
        if target == root or root in target.parents:
            return target
    raise ToolError("Percorso fuori dalle cartelle autorizzate: non consentito.")


APP_ROOT = Path(__file__).resolve().parents[3]
SECRET_NAMES = {".env", "id_rsa", "id_ed25519", "credentials.json", "login data", "cookies"}


def workdir(ctx: ToolContext) -> Path:
    """Cartella di lavoro dell'esecuzione: quella del progetto, se la conversazione ne ha uno."""
    wd = getattr(ctx.run, "workdir", None) if ctx.run is not None else None
    return Path(wd) if wd else ctx.settings.workspace_dir


def resolve(ctx: ToolContext, path: str) -> Path:
    target = safe_path(workdir(ctx), path, ctx.settings.roots)
    ws = ctx.settings.workspace_dir.resolve()
    inside_ws = target == ws or ws in target.parents
    if not inside_ws and (target == APP_ROOT or APP_ROOT in target.parents):
        # I file di AI Locale (modelli, database, configurazione, codice) non si toccano.
        raise ToolError("La cartella di installazione di AI Locale è protetta: lavora nella cartella di lavoro o "
                        "nelle cartelle dei progetti.")
    if target.name.lower() in SECRET_NAMES or target.suffix.lower() in (".pem", ".key", ".kdbx"):
        raise ToolError("File di credenziali protetto: non consentito.")
    return target


def display(ctx: ToolContext, p: Path) -> str:
    ws = ctx.settings.workspace_dir.resolve()
    try:
        return p.relative_to(ws).as_posix() or "."
    except ValueError:
        return str(p)


def truncate(text: str, limit: int = MAX_OUTPUT) -> str:
    if len(text) <= limit:
        return text
    return text[:limit] + f"\n...[troncato, {len(text) - limit} caratteri omessi]"


async def require_approval(ctx: ToolContext, tool: str, preview: str) -> None:
    if ctx.approve is None or not await ctx.approve(tool, preview):
        raise ToolError("L'utente NON ha approvato questa azione. Non riprovarla; prosegui senza.")


def require_web(ctx: ToolContext) -> None:
    if not ctx.run.tunables.get("web_access", True):
        raise ToolError("L'accesso al web è disattivato nelle Impostazioni.")


# ---------------------------------------------------------------------------
# Comandi
# ---------------------------------------------------------------------------
BLOCKED_PATTERNS = [
    r"\brm\s+(-[a-z]*r[a-z]*f|-[a-z]*f[a-z]*r)[a-z]*\s+(/|~|\*|\$HOME)(\s|$)",
    r"\bmkfs(\.\w+)?\b", r"\bdd\s+if=", r"\bformat(\.com)?\s+[a-z]:", r"\bformat-volume\b",
    r"\bdiskpart\b", r"\bbcdedit\b", r"\bvssadmin\s+delete\b", r"\bcipher\s+/w\b",
    r"\b(del|erase)\s+.*?/s\b.*?[a-z]:\\\s*($|\*)", r"\b(rd|rmdir)\s+/s\b.*?[a-z]:\\\s*$",
    r"remove-item\b.*-recurse\b.*\b[a-z]:\\\s*(\*|$|\s)",
    r"\bshutdown\b", r"\brestart-computer\b", r"\bstop-computer\b",
    r"\breg\s+delete\b", r"\bset-executionpolicy\b",
    r":\(\)\s*\{\s*:\|:&\s*\};:",
    r"(iwr|invoke-webrequest|curl|wget)\b.*\|\s*(iex|invoke-expression|sh|bash)\b",
    r"\b(net\s+user|net\s+localgroup)\b.*\s/(add|delete)\b",
    r"\.env\b.*\b(type|cat|get-content|more)\b|\b(type|cat|get-content|more)\b.*\.env\b",
]


def check_command(command: str) -> None:
    low = command.lower()
    for pat in BLOCKED_PATTERNS:
        if re.search(pat, low):
            raise ToolError("Comando bloccato dalle regole di sicurezza (potenzialmente distruttivo o sensibile).")


def _clean_env() -> dict:
    env = {k: v for k, v in os.environ.items()
           if not any(s in k.upper() for s in ("TOKEN", "SECRET", "API_KEY", "PASSWORD"))}
    env["PYTHONIOENCODING"] = "utf-8"
    return env


async def _run_process(argv: list[str], cwd: Path, timeout: int) -> str:
    env = _clean_env()
    try:
        proc = await asyncio.create_subprocess_exec(
            *argv, cwd=str(cwd), env=env,
            stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.STDOUT)
    except NotImplementedError:
        return await asyncio.to_thread(_run_process_sync, argv, cwd, env, timeout)
    try:
        out, _ = await asyncio.wait_for(proc.communicate(), timeout=timeout)
    except asyncio.TimeoutError:
        proc.kill()
        await proc.wait()
        return f"[timeout dopo {timeout}s: processo terminato]"
    return truncate(f"[exit code {proc.returncode}]\n{out.decode('utf-8', 'replace')}")


def _run_process_sync(argv: list[str], cwd: Path, env: dict, timeout: int) -> str:
    try:
        r = subprocess.run(argv, cwd=str(cwd), env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                           timeout=timeout)
    except subprocess.TimeoutExpired:
        return f"[timeout dopo {timeout}s: processo terminato]"
    return truncate(f"[exit code {r.returncode}]\n{r.stdout.decode('utf-8', 'replace')}")


# ---------------------------------------------------------------------------
# File system
# ---------------------------------------------------------------------------
async def list_files(ctx: ToolContext, path: str = ".") -> str:
    target = resolve(ctx, path)
    if not target.exists():
        raise ToolError(f"'{path}' non esiste.")
    if target.is_file():
        return f"{display(ctx, target)} è un file ({target.stat().st_size} byte)"
    entries = []
    for p in sorted(target.iterdir(), key=lambda x: (x.is_file(), x.name.lower()))[:300]:
        if p.name in TEXT_SKIP_DIRS:
            continue
        entries.append(f"{display(ctx, p)}/" if p.is_dir() else f"{display(ctx, p)} ({p.stat().st_size} byte)")
    header = ""
    if path in (".", "") and len(ctx.settings.roots) > 1:
        header = "Cartelle autorizzate: " + ", ".join(str(r) for r in ctx.settings.roots[1:]) + "\n\n"
    return header + ("\n".join(entries) or "(cartella vuota)")


async def read_file(ctx: ToolContext, path: str) -> str:
    target = resolve(ctx, path)
    if not target.is_file():
        raise ToolError(f"File '{path}' non trovato.")
    if target.name == ".env" or target.suffix in (".key", ".pem", ".pfx"):
        raise ToolError("File di segreti: lettura non consentita agli agenti.")
    if target.suffix.lower() in (".pdf", ".docx", ".xlsx", ".pptx", ".csv", ".png", ".jpg", ".jpeg", ".webp"):
        return await read_document(ctx, path)
    data = target.read_bytes()[: MAX_READ * 4]
    if b"\x00" in data[:4096]:
        raise ToolError("File binario: non leggibile come testo.")
    return truncate(data.decode("utf-8", "replace"), MAX_READ)


def _backup_file(ctx: ToolContext, target: Path) -> Path:
    dest = ctx.settings.data_dir / "file-backups" / time.strftime("%Y%m%d-%H%M%S")
    dest.mkdir(parents=True, exist_ok=True)
    copy = dest / f"{uuid.uuid4().hex[:6]}_{target.name}"
    shutil.copy2(target, copy)
    return copy


EXEC_EXT = {".exe", ".bat", ".cmd", ".ps1", ".vbs", ".scr", ".msi", ".dll", ".com", ".lnk", ".reg"}


async def write_file(ctx: ToolContext, path: str, content: str) -> str:
    target = resolve(ctx, path)
    if target.suffix.lower() in EXEC_EXT or target.name == ".env":
        raise ToolError("Per sicurezza gli agenti non possono creare eseguibili, script di sistema o file .env.")
    target.parent.mkdir(parents=True, exist_ok=True)
    note = ""
    if target.exists():
        old = target.read_text(encoding="utf-8", errors="replace")
        diff = _short_diff(old, content)
        await require_approval(ctx, "write_file", f"Sovrascrive {display(ctx, target)}\n\n{diff}")
        backup = _backup_file(ctx, target)
        note = f" (backup della versione precedente: {backup.name})"
    target.write_text(content, encoding="utf-8")
    touched = getattr(ctx.run, "touched", None) if ctx.run is not None else None
    if isinstance(touched, set):
        touched.add(str(target))
    return f"Scritto {display(ctx, target)} ({len(content)} caratteri){note}"


def _short_diff(old: str, new: str) -> str:
    import difflib
    lines = list(difflib.unified_diff(old.splitlines(), new.splitlines(), "prima", "dopo", lineterm="", n=2))
    return truncate("\n".join(lines) or "(nessuna differenza)", 3500)


async def make_dir(ctx: ToolContext, path: str) -> str:
    target = resolve(ctx, path)
    target.mkdir(parents=True, exist_ok=True)
    return f"Cartella pronta: {display(ctx, target)}"


async def move_file(ctx: ToolContext, source: str, destination: str) -> str:
    src, dst = resolve(ctx, source), resolve(ctx, destination)
    if not src.exists():
        raise ToolError(f"'{source}' non esiste.")
    if dst.exists() and dst.is_dir():
        dst = dst / src.name
    if dst.exists():
        raise ToolError(f"'{display(ctx, dst)}' esiste già: scegli un altro nome.")
    await require_approval(ctx, "move_file", f"Sposta / rinomina\n{display(ctx, src)}\n-> {display(ctx, dst)}")
    dst.parent.mkdir(parents=True, exist_ok=True)
    shutil.move(str(src), str(dst))
    return f"Spostato in {display(ctx, dst)}"


async def delete_file(ctx: ToolContext, path: str) -> str:
    target = resolve(ctx, path)
    if not target.exists():
        raise ToolError(f"'{path}' non esiste.")
    if target in ctx.settings.roots:
        raise ToolError("Non si può eliminare una cartella autorizzata principale.")
    await require_approval(ctx, "delete_file", f"Sposta nel cestino di AI Locale (recuperabile):\n{display(ctx, target)}")
    trash = ctx.settings.data_dir / "trash" / time.strftime("%Y%m%d-%H%M%S")
    trash.mkdir(parents=True, exist_ok=True)
    shutil.move(str(target), str(trash / target.name))
    return f"Spostato nel cestino: {trash / target.name}"


async def search_text(ctx: ToolContext, pattern: str, path: str = ".", max_results: int = 60) -> str:
    root = resolve(ctx, path)
    try:
        rx = re.compile(pattern, re.IGNORECASE)
    except re.error:
        rx = re.compile(re.escape(pattern), re.IGNORECASE)
    hits, scanned = [], 0
    files = [root] if root.is_file() else root.rglob("*")
    for f in files:
        if any(part in TEXT_SKIP_DIRS for part in f.parts) or not f.is_file() or f.stat().st_size > 2_000_000:
            continue
        scanned += 1
        if scanned > 5000:
            break
        try:
            with f.open("r", encoding="utf-8", errors="strict") as fh:
                for i, line in enumerate(fh, 1):
                    if rx.search(line):
                        hits.append(f"{display(ctx, f)}:{i}: {line.strip()[:200]}")
                        if len(hits) >= max_results:
                            break
        except (UnicodeDecodeError, OSError):
            continue
        if len(hits) >= max_results:
            break
    return "\n".join(hits) or f"Nessuna corrispondenza ({scanned} file esaminati)."


async def read_document(ctx: ToolContext, path: str) -> str:
    """Legge PDF (con OCR se scansionato), Word, Excel, PowerPoint, CSV e immagini (OCR)."""
    target = resolve(ctx, path)
    if not target.is_file():
        raise ToolError(f"File '{path}' non trovato.")
    ext = target.suffix.lower()
    if ext == ".pdf":
        from pypdf import PdfReader
        reader = PdfReader(str(target))
        parts = []
        for i, page in enumerate(reader.pages[:60]):
            text = (page.extract_text() or "").strip()
            if len(text) < 20 and ctx.vision is not None and await ctx.vision.ocr_available():
                from ..vision import render_pdf_page
                img = await asyncio.to_thread(render_pdf_page, str(target), i)
                text = "[OCR] " + (await ctx.vision.ocr_image(img)).strip()
            parts.append(f"[p. {i + 1}]\n{text}")
        return truncate("\n\n".join(parts), MAX_READ)
    if ext == ".docx":
        import docx
        d = docx.Document(str(target))
        rows = [p.text for p in d.paragraphs]
        for t in d.tables:
            rows += [" | ".join(c.text for c in r.cells) for r in t.rows]
        return truncate("\n".join(rows), MAX_READ)
    if ext == ".xlsx":
        try:
            import openpyxl
        except ImportError as exc:
            raise ToolError("Per leggere Excel installa openpyxl.") from exc
        wb = openpyxl.load_workbook(str(target), read_only=True, data_only=True)
        out = []
        for ws in wb.worksheets[:10]:
            out.append(f"## Foglio: {ws.title}")
            for r, row in enumerate(ws.iter_rows(values_only=True)):
                if r >= 200:
                    out.append("...")
                    break
                out.append(" | ".join("" if v is None else str(v) for v in row))
        return truncate("\n".join(out), MAX_READ)
    if ext == ".pptx":
        try:
            from pptx import Presentation
        except ImportError as exc:
            raise ToolError("Per leggere PowerPoint installa python-pptx.") from exc
        prs = Presentation(str(target))
        out = []
        for i, slide in enumerate(prs.slides, 1):
            texts = [sh.text_frame.text for sh in slide.shapes if getattr(sh, "has_text_frame", False)]
            out.append(f"## Slide {i}\n" + "\n".join(t for t in texts if t.strip()))
        return truncate("\n\n".join(out), MAX_READ)
    if ext == ".csv":
        raw = target.read_text(encoding="utf-8", errors="replace")
        rows = list(csv.reader(io.StringIO(raw)))
        return truncate(f"{len(rows)} righe\n" + "\n".join(" | ".join(r) for r in rows[:200]), MAX_READ)
    if ext in (".png", ".jpg", ".jpeg", ".webp"):
        if ctx.vision is None or not await ctx.vision.ocr_available():
            raise ToolError("OCR non disponibile: installa Tesseract o attiva un modello di visione.")
        return truncate("[OCR]\n" + await ctx.vision.ocr_image(target.read_bytes()), MAX_READ)
    return await read_file(ctx, path)


# ---------------------------------------------------------------------------
# Codice e comandi
# ---------------------------------------------------------------------------
async def run_python(ctx: ToolContext, code: str) -> str:
    runs = ctx.settings.workspace_dir / ".runs"
    runs.mkdir(parents=True, exist_ok=True)
    script = runs / f"run_{uuid.uuid4().hex[:8]}.py"
    script.write_text(code, encoding="utf-8")
    try:
        return await _run_process([sys.executable, "-I", str(script)], workdir(ctx),
                                  ctx.settings.command_timeout)
    finally:
        script.unlink(missing_ok=True)


async def run_command(ctx: ToolContext, command: str, cwd: str = ".") -> str:
    check_command(command)
    workdir = resolve(ctx, cwd)
    if not workdir.is_dir():
        raise ToolError(f"Cartella '{cwd}' inesistente.")
    if os.name == "nt":
        argv = ["powershell", "-NoProfile", "-NonInteractive", "-Command", command]
    else:
        argv = ["/bin/sh", "-c", command]
    return await _run_process(argv, workdir, ctx.settings.command_timeout)


# ---------------------------------------------------------------------------
# Documenti, memoria, collaborazione
# ---------------------------------------------------------------------------
async def search_documents(ctx: ToolContext, query: str, k: int | None = None) -> str:
    top_k = int(k or ctx.run.tunables.get("rag_top_k", 5))
    hits = await ctx.rag.search(query, collections=ctx.run.collections or None, k=top_k)
    if not hits:
        return "Nessun passaggio rilevante trovato nei documenti."
    out = []
    for h in hits:
        where = f"{h['filename']}" + (f", p. {h['page']}" if h.get("page") else "")
        out.append(f"[{where}] (rilevanza {h['score']:.2f})\n{h['text']}")
        ctx.run.add_source(h)
    return truncate("\n\n---\n\n".join(out), 9000)


async def recall_memory(ctx: ToolContext, query: str = "") -> str:
    mems = ctx.db.list_memories()
    if not mems:
        return "La memoria è vuota."
    if query:
        words = set(re.findall(r"\w{3,}", query.lower()))
        scored = [(sum(w in m["content"].lower() for w in words), m) for m in mems]
        scored = [s for s in scored if s[0] > 0] or [(0, m) for m in mems]
        mems = [m for _, m in sorted(scored, key=lambda x: -x[0])]
    return "\n".join(f"- {m['content']}" for m in mems[:20])


async def remember(ctx: ToolContext, content: str) -> str:
    m = ctx.db.add_memory(content, source=f"agente:{ctx.agent}")
    return f"Salvato in memoria (id {m['id']})."


async def note(ctx: ToolContext, text: str) -> str:
    ctx.run.blackboard.post("note", ctx.agent, text)
    await ctx.run.emit("note", agent=ctx.agent, text=text[:1000])
    return "Nota pubblicata sulla lavagna condivisa."


async def ask_agent(ctx: ToolContext, agent: str, question: str) -> str:
    return await ctx.consult(ctx.agent, agent, question)


# ---------------------------------------------------------------------------
# Web e browser
# ---------------------------------------------------------------------------
async def web_search(ctx: ToolContext, query: str, max_results: int = 6) -> str:
    require_web(ctx)
    results = await ctx.web.search(query, max(1, min(10, int(max_results))))
    if not results:
        return "Nessun risultato."
    for r in results:
        ctx.run.add_web_source(r["title"], r["url"])
    from .web import UNTRUSTED_HEADER
    return UNTRUSTED_HEADER + "\n\n" + "\n\n".join(
        f"[{i}] {r['title']}\n{r['url']}\n{r['snippet']}" for i, r in enumerate(results, 1))


async def fetch_url(ctx: ToolContext, url: str) -> str:
    require_web(ctx)
    page = await ctx.web.fetch(url)
    ctx.run.add_web_source(page["title"] or page["url"], page["url"])
    from .web import UNTRUSTED_HEADER
    links = "\n".join(f"- {t}: {u}" for t, u in page["links"][:15])
    return truncate(f"{UNTRUSTED_HEADER}\nTITOLO: {page['title']}\nURL: {page['url']}\n\n{page['text']}"
                    + ("\n[pagina troncata]" if page["truncated"] else "")
                    + (f"\n\nLINK PRINCIPALI:\n{links}" if links else ""), 14000)


async def browser_open(ctx: ToolContext, url: str) -> str:
    require_web(ctx)
    out = await ctx.browser.open(url)
    ctx.run.add_web_source(url, url)
    return truncate(out, 12000)


async def browser_click(ctx: ToolContext, element: int) -> str:
    require_web(ctx)
    el = ctx.browser.element(element)
    if el.get("submit"):
        await require_approval(ctx, "browser_click", f"Invia un modulo sul sito cliccando: {el['label']!r}")
    return truncate(await ctx.browser.click(element), 12000)


async def browser_type(ctx: ToolContext, element: int, text: str, submit: bool = False) -> str:
    require_web(ctx)
    el = ctx.browser.element(element)
    if submit:
        await require_approval(ctx, "browser_type",
                               f"Scrive nel campo {el['label']!r} e INVIA:\n{text[:500]}")
    return truncate(await ctx.browser.type(element, text, bool(submit)), 12000)


async def browser_back(ctx: ToolContext) -> str:
    require_web(ctx)
    return truncate(await ctx.browser.back(), 12000)


async def browser_screenshot(ctx: ToolContext, question: str = "") -> str:
    require_web(ctx)
    path = await ctx.browser.screenshot(ctx.settings.workspace_dir / "screenshots")
    msg = f"Screenshot salvato: {display(ctx, path)}"
    if question and ctx.vision is not None and await ctx.vision.available():
        msg += "\n\nAnalisi:\n" + await ctx.vision.describe(path.read_bytes(), question)
    return msg


async def analyze_image(ctx: ToolContext, path: str, question: str = "") -> str:
    target = _image_path(ctx, path)
    from ..vision import VisionError
    try:
        return await ctx.vision.describe(target.read_bytes(), question or "Descrivi l'immagine in dettaglio.")
    except VisionError as exc:
        raise ToolError(str(exc)) from exc


def _image_path(ctx: ToolContext, path: str) -> Path:
    path = (path or "").strip()
    if path.startswith("uploads/"):
        target = (ctx.settings.data_dir / "uploads" / Path(path).name).resolve()
        if not target.is_file():
            raise ToolError("Immagine non trovata tra gli allegati.")
        return target
    target = resolve(ctx, path)
    if not target.is_file():
        raise ToolError(f"Immagine '{path}' non trovata.")
    return target


# ---------------------------------------------------------------------------
# Stato del PC (misure vere, non interpretate dal modello)
# ---------------------------------------------------------------------------
async def system_info(ctx: ToolContext, top: int = 10) -> str:
    import psutil
    from ..system import gpu_metrics
    top = max(3, min(int(top or 10), 25))
    gb = 1024 ** 3
    own = {os.getpid()}
    try:
        me = psutil.Process()
        own |= {c.pid for c in me.children(recursive=True)}
    except psutil.Error:
        pass
    procs = []
    for p in psutil.process_iter(["pid", "name"]):
        try:
            p.cpu_percent(None)
            procs.append(p)
        except psutil.Error:
            pass
    await asyncio.sleep(1.0)  # la % di CPU si misura su un intervallo
    ncpu = psutil.cpu_count() or 1
    rows = []
    for p in procs:
        try:
            cpu = p.cpu_percent(None) / ncpu
            rss = p.memory_info().rss
            rows.append((p.info["name"] or "?", p.info["pid"], cpu, rss, p.info["pid"] in own))
        except psutil.Error:
            pass

    def fmt(r):
        tag = "  <- AI Locale (questo programma)" if r[4] else ""
        return f"  {r[0]} (pid {r[1]}): CPU {r[2]:.1f}% · RAM {r[3] / 1024 ** 2:.0f} MB{tag}"
    lines = [f"CPU totale: {psutil.cpu_percent(None):.0f}% su {ncpu} core logici "
             f"(percentuali dei processi = quota del PC intero, misurata in 1 s)"]
    vm = psutil.virtual_memory()
    lines.append(f"RAM: {(vm.total - vm.available) / gb:.1f} / {vm.total / gb:.1f} GB usati ({vm.percent:.0f}%)")
    lines.append("Dischi:")
    for part in psutil.disk_partitions(all=False):
        try:
            du = psutil.disk_usage(part.mountpoint)
            lines.append(f"  {part.mountpoint} {du.free / gb:.0f} GB liberi su {du.total / gb:.0f} GB ({du.percent:.0f}% usato)")
        except (PermissionError, OSError):
            pass
    g = gpu_metrics()
    if g.get("available"):
        for x in g["gpus"]:
            lines.append(f"GPU {x['name']}: uso {x['util_percent']}% · VRAM {x['vram_used'] / gb:.1f}/{x['vram_total'] / gb:.1f} GB"
                         f" · {x['temperature_c']} °C · driver {g.get('driver')}")
        lines.append("  Nota: la VRAM è occupata in gran parte dal modello AI di AI Locale (llama-server): è normale.")
    else:
        lines.append(f"GPU: non disponibile ({g.get('reason')})")
    lines.append(f"Top {top} processi per CPU:")
    lines += [fmt(r) for r in sorted(rows, key=lambda r: -r[2])[:top]]
    lines.append(f"Top {top} processi per RAM:")
    lines += [fmt(r) for r in sorted(rows, key=lambda r: -r[3])[:top]]
    lines.append("Nota: i processi llama-server sono il motore AI di AI Locale; non sono un problema.")
    return "\n".join(lines)


# ---------------------------------------------------------------------------
# Spegnimento, riavvio, blocco (sempre con il permesso dell'utente)
# ---------------------------------------------------------------------------
POWER_ACTIONS = {
    "spegni": ["shutdown", "/s", "/t"], "riavvia": ["shutdown", "/r", "/t"],
    "blocca": ["rundll32.exe", "user32.dll,LockWorkStation"], "annulla": ["shutdown", "/a"],
}
POWER_LABELS = {"spegni": "Spegnere il PC", "riavvia": "Riavviare il PC", "blocca": "Bloccare lo schermo",
                "annulla": "Annullare lo spegnimento o il riavvio programmato"}


def _power_preview(args: dict) -> str:
    action = str(args.get("action", "")).lower()
    delay = max(30, min(int(args.get("delay_seconds") or 60), 3600))
    label = POWER_LABELS.get(action, f"Azione sconosciuta: {action}")
    extra = f"\nTra {delay} secondi. Per annullare: chiedi 'annulla lo spegnimento' o esegui shutdown /a." \
        if action in ("spegni", "riavvia") else ""
    return f"{label}{extra}\nSalva il lavoro aperto prima di confermare."


async def power_action(ctx: ToolContext, action: str, delay_seconds: int = 60) -> str:
    action = (action or "").strip().lower()
    if action not in POWER_ACTIONS:
        raise ToolError("Azione non valida: usa spegni, riavvia, blocca o annulla.")
    if os.name != "nt":
        raise ToolError("Spegnimento e riavvio sono disponibili solo su Windows.")
    argv = list(POWER_ACTIONS[action])
    if action in ("spegni", "riavvia"):
        delay = max(30, min(int(delay_seconds or 60), 3600))
        argv += [str(delay), "/c", "AI Locale: richiesto dall'utente"]
    out = await _run_process(argv, ctx.settings.workspace_dir, 30)
    return f"{POWER_LABELS[action]}: comando inviato.\n{out}".strip()


# ---------------------------------------------------------------------------
def build_registry() -> ToolRegistry:
    r = ToolRegistry()
    s = {"type": "string"}
    i = {"type": "integer"}

    def add(name, desc, params, handler, risk="read", required=None, **kw):
        r.register(Tool(name, desc, obj(params, required), handler, risk=risk, **kw))

    add("list_files", "Elenca file e cartelle (cartella di lavoro o cartelle autorizzate).",
        {"path": {**s, "description": "Percorso relativo o assoluto autorizzato; default '.'"}}, list_files)
    add("read_file", "Legge un file (testo, codice; PDF/Word/Excel/PowerPoint/immagini vengono convertiti in testo).",
        {"path": s}, read_file, required=["path"])
    add("read_document", "Estrae il testo da PDF (con OCR se scansionato), DOCX, XLSX, PPTX, CSV o immagini.",
        {"path": s}, read_document, required=["path"])
    add("search_text", "Cerca testo o regex nei file di una cartella (come grep).",
        {"pattern": s, "path": s}, search_text, required=["pattern"])
    add("write_file", "Crea o aggiorna un file di testo/codice. Sovrascrivere richiede approvazione e salva un backup.",
        {"path": s, "content": s}, write_file, risk="write", required=["path", "content"])
    add("make_dir", "Crea una cartella (anche annidata), per esempio per un nuovo progetto.",
        {"path": s}, make_dir, risk="write", required=["path"])
    add("move_file", "Sposta o rinomina un file/cartella. Richiede approvazione.",
        {"source": s, "destination": s}, move_file, risk="write", required=["source", "destination"])
    add("delete_file", "Sposta un file/cartella nel cestino di AI Locale (recuperabile). Richiede approvazione.",
        {"path": s}, delete_file, risk="write", required=["path"])
    add("power_action", "Spegne, riavvia (con 60 s di preavviso) o blocca il PC, oppure annulla uno spegnimento. "
        "Chiede SEMPRE il permesso all'utente.",
        {"action": {**s, "enum": ["spegni", "riavvia", "blocca", "annulla"]},
         "delay_seconds": {**i, "description": "Secondi prima di spegnere/riavviare (30-3600, default 60)"}},
        power_action, risk="external", required=["action"], requires_approval=True, preview=_power_preview)
    add("system_info", "Misura lo stato del PC: CPU % reale per processo, RAM, dischi, GPU (VRAM, temperatura).",
        {"top": {**i, "description": "Quanti processi elencare (default 10)"}}, system_info)
    add("run_python", "Esegue codice Python nella cartella di lavoro e restituisce l'output. Richiede approvazione.",
        {"code": s}, run_python, risk="exec", required=["code"], requires_approval=True,
        preview=lambda a: str(a.get("code", "")))
    add("run_command", "Esegue un comando di shell (PowerShell su Windows), es. test, git, npm. Richiede approvazione.",
        {"command": s, "cwd": {**s, "description": "cartella in cui eseguirlo, default '.'"}}, run_command,
        risk="exec", required=["command"], requires_approval=True,
        preview=lambda a: f"{a.get('command', '')}\n(cartella: {a.get('cwd', '.')})")
    add("search_documents", "Ricerca semantica nei documenti caricati dall'utente, con file e pagina.",
        {"query": s, "k": i}, search_documents, required=["query"])
    add("recall_memory", "Legge le informazioni salvate nella memoria persistente dell'utente.",
        {"query": s}, recall_memory)
    add("remember", "Propone di salvare un'informazione duratura in memoria. Richiede approvazione.",
        {"content": s}, remember, risk="write", required=["content"], requires_approval=True,
        preview=lambda a: str(a.get("content", "")))
    add("note", "Pubblica una nota sulla lavagna condivisa, visibile a tutti gli agenti.", {"text": s}, note,
        required=["text"])
    add("ask_agent", "Chiede aiuto o un parere a un altro agente del team.",
        {"agent": {**s, "description": "id dell'agente"}, "question": s}, ask_agent, required=["agent", "question"])
    add("web_search", "Cerca informazioni aggiornate sul web. Restituisce titoli, link e anteprime.",
        {"query": s, "max_results": i}, web_search, risk="network", required=["query"])
    add("fetch_url", "Scarica e legge il testo di una pagina web o di un PDF online.",
        {"url": s}, fetch_url, risk="network", required=["url"])
    add("browser_open", "Apre un sito nel browser automatico e mostra testo ed elementi numerati.",
        {"url": s}, browser_open, risk="network", required=["url"])
    add("browser_click", "Clicca l'elemento numerato della pagina aperta. Gli invii di moduli richiedono approvazione.",
        {"element": i}, browser_click, risk="external", required=["element"])
    add("browser_type", "Scrive in un campo numerato; con submit=true invia (richiede approvazione). Mai password.",
        {"element": i, "text": s, "submit": {"type": "boolean"}}, browser_type, risk="external",
        required=["element", "text"])
    add("browser_back", "Torna alla pagina precedente del browser.", {}, browser_back, risk="network")
    add("browser_screenshot", "Fotografa la pagina del browser; con 'question' la fa analizzare dalla visione.",
        {"question": s}, browser_screenshot, risk="network")
    add("analyze_image", "Analizza un'immagine (allegato 'uploads/...' o file autorizzato) con il modello di visione.",
        {"path": s, "question": s}, analyze_image, required=["path"])
    return r
