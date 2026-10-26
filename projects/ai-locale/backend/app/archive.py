"""Archivi sicuri: creare, ispezionare ed estrarre .zip e .tar senza farsi male.

Un archivio e' dato non fidato: i nomi dentro possono puntare fuori dalla cartella
(zip-slip), un file da 1 KB puo' espanderne 10 GB (zip bomb), un tar puo' contenere
collegamenti simbolici verso /etc o C:\\Windows. Qui ogni voce viene controllata
PRIMA di scrivere qualsiasi cosa: se anche una sola e' sospetta, non si estrae nulla.
"""
from __future__ import annotations

import re
import tarfile
import zipfile
from dataclasses import dataclass
from pathlib import Path, PurePosixPath

MAX_ENTRIES = 20_000
MAX_TOTAL = 4 * 1024 ** 3        # 4 GB estratti in tutto
MAX_SINGLE = 2 * 1024 ** 3       # 2 GB per singolo file
MAX_RATIO = 200                  # espansione massima: 200x (una bomba supera le migliaia)
RATIO_FLOOR = 32 * 1024 ** 2     # sotto 32 MB estratti il rapporto non conta: non puo' far danni
TAR_SUFFIXES = (".tar", ".tgz", ".tbz2", ".txz")


class ArchiveError(Exception):
    pass


@dataclass
class Entry:
    name: str
    size: int
    compressed: int
    is_dir: bool


def kind(path: Path) -> str:
    name = path.name.lower()
    if name.endswith(".zip"):
        return "zip"
    if name.endswith(TAR_SUFFIXES) or re.search(r"\.tar\.(gz|bz2|xz)$", name):
        return "tar"
    raise ArchiveError(f"Formato non gestito: {path.name}. Sono supportati .zip, .tar, .tar.gz, .tgz, .tar.bz2, .tar.xz.")


def _unsafe_name(name: str) -> str | None:
    """Restituisce il motivo per cui un nome e' pericoloso, oppure None se e' a posto."""
    if not name or name in (".", "./"):
        return "nome vuoto"
    n = name.replace("\\", "/")
    if n.startswith("/"):
        return "percorso assoluto"
    if re.match(r"^[a-zA-Z]:", n):
        return "percorso con lettera di unita' (C:\\...)"
    if any(part == ".." for part in PurePosixPath(n).parts):
        return "risale alle cartelle superiori (..)"
    if "\x00" in n:
        return "carattere nullo nel nome"
    return None


def read_entries(path: Path) -> list[Entry]:
    k = kind(path)
    out: list[Entry] = []
    try:
        if k == "zip":
            with zipfile.ZipFile(path) as z:
                for info in z.infolist():
                    out.append(Entry(info.filename, info.file_size, info.compress_size, info.is_dir()))
        else:
            with tarfile.open(path, "r:*") as t:
                for m in t.getmembers():
                    if not (m.isfile() or m.isdir()):
                        raise ArchiveError(f"L'archivio contiene una voce speciale (collegamento o dispositivo): "
                                           f"{m.name}. Per sicurezza non viene aperto.")
                    out.append(Entry(m.name, m.size, m.size, m.isdir()))
    except (zipfile.BadZipFile, tarfile.TarError, EOFError) as exc:
        raise ArchiveError(f"Archivio illeggibile o danneggiato: {exc}") from exc
    if len(out) > MAX_ENTRIES:
        raise ArchiveError(f"L'archivio contiene {len(out)} voci (limite {MAX_ENTRIES}).")
    return out


def check(path: Path, entries: list[Entry] | None = None) -> dict:
    """Controlla nomi e dimensioni. Solleva ArchiveError al primo problema serio."""
    entries = entries if entries is not None else read_entries(path)
    total = 0
    for e in entries:
        reason = _unsafe_name(e.name)
        if reason:
            raise ArchiveError(f"Voce pericolosa nell'archivio ({reason}): {e.name!r}. Estrazione annullata.")
        if e.size > MAX_SINGLE:
            raise ArchiveError(f"La voce {e.name!r} occuperebbe {e.size / 1024 ** 3:.1f} GB una volta estratta "
                               f"(limite {MAX_SINGLE // 1024 ** 3} GB).")
        total += e.size
    if total > MAX_TOTAL:
        raise ArchiveError(f"L'archivio estratto occuperebbe {total / 1024 ** 3:.1f} GB "
                           f"(limite {MAX_TOTAL // 1024 ** 3} GB).")
    packed = path.stat().st_size
    ratio = total / packed if packed else 0.0
    # Il rapporto va misurato su quanto si ESPANDE, non su quanto pesa l'archivio:
    # 60 MB di zeri stanno in 60 KB, e un limite sul compresso li lascerebbe passare.
    if total >= RATIO_FLOOR and ratio > MAX_RATIO:
        raise ArchiveError(f"Rapporto di compressione sospetto ({ratio:.0f}x, limite {MAX_RATIO}x): "
                           "potrebbe essere una 'zip bomb'. Estrazione annullata.")
    return {"entries": len(entries), "files": sum(0 if e.is_dir else 1 for e in entries),
            "total_bytes": total, "packed_bytes": packed, "ratio": round(ratio, 1)}


def extract(path: Path, dest: Path) -> dict:
    """Estrae dopo aver controllato tutto. Ogni file viene comunque riverificato alla scrittura."""
    entries = read_entries(path)
    info = check(path, entries)
    dest = dest.resolve()
    dest.mkdir(parents=True, exist_ok=True)
    written: list[str] = []

    def target_of(name: str) -> Path:
        t = (dest / name.replace("\\", "/")).resolve()
        if t != dest and dest not in t.parents:          # seconda rete: dopo la risoluzione reale
            raise ArchiveError(f"Voce che uscirebbe dalla cartella di destinazione: {name!r}.")
        return t

    if kind(path) == "zip":
        with zipfile.ZipFile(path) as z:
            for e in entries:
                t = target_of(e.name)
                if e.is_dir:
                    t.mkdir(parents=True, exist_ok=True)
                    continue
                t.parent.mkdir(parents=True, exist_ok=True)
                with z.open(e.name) as src, open(t, "wb") as out:
                    remaining = e.size + 1
                    while chunk := src.read(1 << 20):
                        remaining -= len(chunk)
                        if remaining < 0:               # dichiara meno di quello che scrive
                            out.close()
                            t.unlink(missing_ok=True)
                            raise ArchiveError(f"La voce {e.name!r} scrive piu' byte di quanti ne dichiari.")
                        out.write(chunk)
                written.append(e.name)
    else:
        with tarfile.open(path, "r:*") as t_arc:
            for e in entries:
                target_of(e.name)
            t_arc.extractall(dest, filter="data")        # filtro di Python: niente link, niente percorsi assoluti
            written = [e.name for e in entries if not e.is_dir]
    return {**info, "extracted": len(written), "dest": str(dest), "names": written[:50]}


def create(sources: list[Path], out_path: Path, base: Path) -> dict:
    """Crea uno .zip. I nomi dentro l'archivio sono relativi a `base`, mai assoluti."""
    if out_path.suffix.lower() != ".zip":
        out_path = out_path.with_suffix(".zip")
    base = base.resolve()
    files: list[tuple[Path, str]] = []
    for src in sources:
        src = src.resolve()
        if src.is_dir():
            for f in sorted(src.rglob("*")):
                if f.is_file() and not f.is_symlink():
                    files.append((f, f.relative_to(base).as_posix() if base in f.parents else f.name))
        elif src.is_file():
            if src.is_symlink():
                raise ArchiveError(f"{src.name} e' un collegamento simbolico: non viene archiviato.")
            files.append((src, src.relative_to(base).as_posix() if base in src.parents else src.name))
        else:
            raise ArchiveError(f"Non trovato: {src}")
    if not files:
        raise ArchiveError("Nessun file da archiviare.")
    if len(files) > MAX_ENTRIES:
        raise ArchiveError(f"Troppi file ({len(files)}, limite {MAX_ENTRIES}).")
    out_path.parent.mkdir(parents=True, exist_ok=True)
    total = 0
    with zipfile.ZipFile(out_path, "w", zipfile.ZIP_DEFLATED, compresslevel=6) as z:
        for f, arcname in files:
            if f.resolve() == out_path.resolve():        # non archiviare l'archivio stesso
                continue
            z.write(f, arcname)
            total += f.stat().st_size
    return {"path": str(out_path), "files": len(files), "source_bytes": total,
            "packed_bytes": out_path.stat().st_size}
