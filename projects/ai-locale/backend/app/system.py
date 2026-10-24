"""Misure reali dell'hardware, gestione di llama-server, log e backup.

Nessun valore è simulato: se una misura non è disponibile (es. GPU senza
driver NVIDIA) viene restituito `available: false` con il motivo.
"""
from __future__ import annotations

import asyncio
import collections
import logging
import os
import shlex
import shutil
import subprocess
import time
import zipfile
from logging.handlers import RotatingFileHandler
from pathlib import Path
from typing import Any

import psutil

log = logging.getLogger("ailocale.system")


# ---------------------------------------------------------------------------
# Log
# ---------------------------------------------------------------------------
class RingBufferHandler(logging.Handler):
    def __init__(self, capacity: int = 200):
        super().__init__(level=logging.WARNING)
        self.records: collections.deque = collections.deque(maxlen=capacity)

    def emit(self, record: logging.LogRecord) -> None:
        self.records.append({"ts": record.created, "level": record.levelname, "logger": record.name,
                             "message": record.getMessage()[:1000],
                             "exc": record.exc_info[0].__name__ if record.exc_info and record.exc_info[0] else None})


ERRORS = RingBufferHandler()


def setup_logging(log_dir: Path) -> Path:
    log_dir.mkdir(parents=True, exist_ok=True)
    path = log_dir / "app.log"
    root = logging.getLogger()
    if not any(isinstance(h, RotatingFileHandler) for h in root.handlers):
        fh = RotatingFileHandler(path, maxBytes=2_000_000, backupCount=3, encoding="utf-8")
        fh.setFormatter(logging.Formatter("%(asctime)s %(levelname)s %(name)s: %(message)s"))
        root.addHandler(fh)
        root.addHandler(ERRORS)
        sh = logging.StreamHandler()
        sh.setFormatter(logging.Formatter("%(levelname)s %(name)s: %(message)s"))
        root.addHandler(sh)
        root.setLevel(logging.INFO)
    return path


def tail_file(path: Path, lines: int = 200) -> list[str]:
    if not path.exists():
        return []
    with path.open("rb") as f:
        f.seek(0, os.SEEK_END)
        size = f.tell()
        f.seek(max(0, size - 256 * 1024))
        data = f.read().decode("utf-8", "replace")
    return data.splitlines()[-lines:]


# ---------------------------------------------------------------------------
# Metriche
# ---------------------------------------------------------------------------
def gpu_metrics() -> dict:
    try:
        import pynvml  # fornito dal pacchetto nvidia-ml-py
        pynvml.nvmlInit()
        try:
            gpus = []
            for i in range(pynvml.nvmlDeviceGetCount()):
                h = pynvml.nvmlDeviceGetHandleByIndex(i)
                mem = pynvml.nvmlDeviceGetMemoryInfo(h)
                util = pynvml.nvmlDeviceGetUtilizationRates(h)
                name = pynvml.nvmlDeviceGetName(h)
                try:
                    temp = pynvml.nvmlDeviceGetTemperature(h, pynvml.NVML_TEMPERATURE_GPU)
                except pynvml.NVMLError:
                    temp = None
                try:
                    power = pynvml.nvmlDeviceGetPowerUsage(h) / 1000
                except pynvml.NVMLError:
                    power = None
                gpus.append({"name": name.decode() if isinstance(name, bytes) else name,
                             "util_percent": util.gpu, "vram_total": mem.total, "vram_used": mem.used,
                             "vram_free": mem.free, "temperature_c": temp, "power_w": power})
            try:
                driver = pynvml.nvmlSystemGetDriverVersion()
                driver = driver.decode() if isinstance(driver, bytes) else driver
            except pynvml.NVMLError:
                driver = None
            return {"available": True, "source": "nvml", "driver": driver, "gpus": gpus}
        finally:
            pynvml.nvmlShutdown()
    except ImportError:
        pass
    except Exception as exc:  # noqa: BLE001
        return {"available": False, "reason": f"NVML: {type(exc).__name__}"}
    # fallback: nvidia-smi
    exe = shutil.which("nvidia-smi")
    if not exe:
        return {"available": False, "reason": "nvidia-ml-py non installato e nvidia-smi non trovato"}
    try:
        out = subprocess.run(
            [exe, "--query-gpu=name,utilization.gpu,memory.total,memory.used,memory.free,temperature.gpu,"
                  "power.draw,driver_version", "--format=csv,noheader,nounits"],
            capture_output=True, text=True, timeout=5, check=True).stdout
    except Exception as exc:  # noqa: BLE001
        return {"available": False, "reason": f"nvidia-smi: {type(exc).__name__}"}
    gpus, driver = [], None

    def num(x: str) -> float | None:
        try:
            return float(x)
        except ValueError:
            return None
    for line in out.strip().splitlines():
        p = [x.strip() for x in line.split(",")]
        if len(p) < 8:
            continue
        mib = 1024 * 1024
        gpus.append({"name": p[0], "util_percent": num(p[1]), "vram_total": int((num(p[2]) or 0) * mib),
                     "vram_used": int((num(p[3]) or 0) * mib), "vram_free": int((num(p[4]) or 0) * mib),
                     "temperature_c": num(p[5]), "power_w": num(p[6])})
        driver = p[7]
    return {"available": bool(gpus), "source": "nvidia-smi", "driver": driver, "gpus": gpus}


def system_metrics(data_dir: Path) -> dict:
    vm = psutil.virtual_memory()
    du = psutil.disk_usage(str(data_dir))
    proc = psutil.Process()
    return {
        "timestamp": time.time(),
        "cpu": {"percent": psutil.cpu_percent(interval=None), "cores_logical": psutil.cpu_count(),
                "cores_physical": psutil.cpu_count(logical=False),
                "freq_mhz": (psutil.cpu_freq().current if psutil.cpu_freq() else None)},
        "ram": {"total": vm.total, "used": vm.total - vm.available, "available": vm.available, "percent": vm.percent},
        "disk": {"path": str(data_dir), "total": du.total, "used": du.used, "free": du.free, "percent": du.percent},
        "gpu": gpu_metrics(),
        "process": {"rss": proc.memory_info().rss, "uptime_s": round(time.time() - proc.create_time())},
        "platform": {"os": os.name, "system": __import__("platform").platform()},
    }


# ---------------------------------------------------------------------------
# Gestione di llama-server
# ---------------------------------------------------------------------------
class ManagedServer:
    """Avvia/arresta un processo llama-server (chat o embedding)."""

    def __init__(self, name: str, settings: Any, port: int, embedding: bool, log_dir: Path):
        self.name = name
        self.settings = settings
        self.port = port
        self.embedding = embedding
        self.log_path = log_dir / f"llama-{name}.log"
        self.proc: subprocess.Popen | None = None
        self.model_file: str | None = None
        self.started_at: float | None = None

    @property
    def available(self) -> bool:
        p = self.settings.llama_server_path
        return bool(p) and Path(p).exists()

    def build_args(self, model_path: Path) -> list[str]:
        s = self.settings
        args = [s.llama_server_path, "-m", str(model_path), "--host", "127.0.0.1", "--port", str(self.port),
                "-ngl", str(s.gpu_layers)]
        if self.embedding:
            args += ["--embeddings", "-c", "2048"]
        else:
            args += ["-c", str(s.ctx_size), "-np", str(s.parallel_slots), "--jinja"]
            if s.chat_mmproj_file:
                mm = (s.models_dir / s.chat_mmproj_file)
                if mm.is_file():
                    args += ["--mmproj", str(mm)]
            if s.llama_extra_args:
                args += shlex.split(s.llama_extra_args, posix=os.name != "nt")
        return args

    def running(self) -> bool:
        return self.proc is not None and self.proc.poll() is None

    async def start(self, model_file: str) -> dict:
        if not self.available:
            raise RuntimeError("LLAMA_SERVER_PATH non configurato o file inesistente")
        path = (self.settings.models_dir / model_file).resolve()
        if self.settings.models_dir.resolve() not in path.parents or not path.is_file():
            raise RuntimeError("Modello non trovato nella cartella models")
        await self.stop()
        logf = self.log_path.open("ab")
        flags = subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0  # type: ignore[attr-defined]
        self.proc = subprocess.Popen(self.build_args(path), stdout=logf, stderr=subprocess.STDOUT,
                                     creationflags=flags)
        self.model_file, self.started_at = model_file, time.time()
        log.info("llama-server %s avviato (pid %s) con %s", self.name, self.proc.pid, model_file)
        return self.status()

    async def stop(self) -> None:
        if self.running():
            assert self.proc is not None
            self.proc.terminate()
            for _ in range(50):
                if self.proc.poll() is not None:
                    break
                await asyncio.sleep(0.1)
            if self.proc.poll() is None:
                self.proc.kill()
            log.info("llama-server %s arrestato", self.name)
        self.proc = None

    def status(self) -> dict:
        return {"name": self.name, "managed": self.available, "running": self.running(),
                "pid": self.proc.pid if self.running() and self.proc else None,
                "model_file": self.model_file if self.running() else None, "port": self.port,
                "started_at": self.started_at if self.running() else None,
                "exit_code": self.proc.poll() if self.proc is not None else None}


def list_models(models_dir: Path) -> list[dict]:
    if not models_dir.exists():
        return []
    return [{"file": p.relative_to(models_dir).as_posix(), "size": p.stat().st_size}
            for p in sorted(models_dir.rglob("*.gguf"))]


def vram_fit_warning(model_size: int, ctx_size: int, gpu: dict) -> str | None:
    """Stima prudente: pesi + ~0.15 MB per token di contesto + 600 MB di margine."""
    if not gpu.get("available") or not gpu.get("gpus"):
        return None
    free = gpu["gpus"][0]["vram_free"]
    need = model_size + ctx_size * 150_000 + 600 * 1024 * 1024
    if need > free:
        return (f"Stima: servono ~{need / 2**30:.1f} GB di VRAM, liberi {free / 2**30:.1f} GB. "
                "Parte del modello andrà in RAM e sarà più lento: valuta una quantizzazione minore o meno contesto.")
    return None


# ---------------------------------------------------------------------------
# Backup
# ---------------------------------------------------------------------------
def create_backup(db: Any, data_dir: Path) -> Path:
    backups = data_dir / "backups"
    backups.mkdir(parents=True, exist_ok=True)
    stamp = time.strftime("%Y%m%d-%H%M%S")
    target = backups / f"backup-{stamp}.zip"
    tmp_db = backups / f".tmp-{stamp}.db"
    db.backup_to(tmp_db)
    try:
        with zipfile.ZipFile(target, "w", zipfile.ZIP_DEFLATED) as z:
            z.write(tmp_db, "ailocale.db")
            docs = data_dir / "documents"
            if docs.exists():
                for f in docs.iterdir():
                    if f.is_file():
                        z.write(f, f"documents/{f.name}")
    finally:
        tmp_db.unlink(missing_ok=True)
    log.info("backup creato: %s", target.name)
    return target


def list_backups(data_dir: Path) -> list[dict]:
    d = data_dir / "backups"
    if not d.exists():
        return []
    return [{"name": p.name, "size": p.stat().st_size, "created": p.stat().st_mtime}
            for p in sorted(d.glob("backup-*.zip"), reverse=True)]


def restore_backup(db: Any, data_dir: Path, name: str) -> dict:
    """Ripristina un backup. Prima crea automaticamente un backup di sicurezza dello stato attuale."""
    src = (data_dir / "backups" / name).resolve()
    if src.parent != (data_dir / "backups").resolve() or not src.is_file() or not name.startswith("backup-"):
        raise FileNotFoundError(name)
    with zipfile.ZipFile(src) as z:
        names = z.namelist()
        if "ailocale.db" not in names:
            raise ValueError("backup non valido: manca il database")
        for n in names:
            if n != "ailocale.db" and not (n.startswith("documents/") and "/" not in n[10:] and ".." not in n):
                raise ValueError(f"backup non valido: voce inattesa {n}")
        safety = create_backup(db, data_dir)
        db.close()
        try:
            for suffix in ("", "-wal", "-shm"):
                Path(str(db.path) + suffix).unlink(missing_ok=True)
            with z.open("ailocale.db") as fsrc, open(db.path, "wb") as fdst:
                shutil.copyfileobj(fsrc, fdst)
            docs = data_dir / "documents"
            shutil.rmtree(docs, ignore_errors=True)
            docs.mkdir(parents=True, exist_ok=True)
            for n in names:
                if n.startswith("documents/") and len(n) > 10:
                    with z.open(n) as fsrc, open(docs / Path(n).name, "wb") as fdst:
                        shutil.copyfileobj(fsrc, fdst)
        finally:
            db.open()
    log.warning("backup %s ripristinato (backup di sicurezza: %s)", name, safety.name)
    return {"restored": name, "safety_backup": safety.name}
