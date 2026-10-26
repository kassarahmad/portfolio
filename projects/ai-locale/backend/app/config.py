"""Configurazione di AI Locale.

Le impostazioni "di sistema" (porte, percorsi, segreti) arrivano da variabili
d'ambiente o dal file `.env` nella radice del progetto. Nessun segreto è scritto
nel codice. Le impostazioni "di comportamento" (temperatura, numero di agenti in
parallelo, ecc.) sono modificabili dall'interfaccia e salvate nel database:
vedi `TUNABLES`.
"""
from __future__ import annotations

import os
import secrets
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[2]


def load_dotenv(path: Path) -> None:
    """Parser minimale di file .env (KEY=VALUE). Non sovrascrive l'ambiente."""
    if not path.exists():
        return
    for raw in path.read_text(encoding="utf-8-sig").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'":
            value = value[1:-1]
        os.environ.setdefault(key, value)


def _bool(value: str | None, default: bool) -> bool:
    if value is None or value == "":
        return default
    return value.strip().lower() in {"1", "true", "yes", "on", "si", "sì"}


def _int(value: str | None, default: int) -> int:
    try:
        return int(value) if value not in (None, "") else default
    except ValueError:
        return default


def _path(value: str | None, default: Path) -> Path:
    if not value:
        return default
    p = Path(value).expanduser()
    return p if p.is_absolute() else (ROOT / p)


@dataclass
class Settings:
    host: str = "127.0.0.1"
    port: int = 8765

    data_dir: Path = ROOT / "data"
    models_dir: Path = ROOT / "models"
    workspace_dir: Path = ROOT / "data" / "workspace"

    # Motore LLM: qualsiasi server compatibile con l'API OpenAI (llama-server consigliato)
    llm_base_url: str = "http://127.0.0.1:8080/v1"
    llm_model: str = "local"
    llm_api_key: str = ""
    llm_timeout: int = 600
    embed_base_url: str = "http://127.0.0.1:8081/v1"
    embed_model: str = "local-embed"
    # Visione: se vuoto usa il modello chat (consigliato un modello multimodale come Qwen3-VL)
    vision_base_url: str = ""
    vision_model: str = ""
    # Modalità locale rigorosa: rifiuta server LLM non locali (cloud)
    strict_local: bool = True

    # Gestione automatica di llama-server (facoltativa)
    llama_server_path: str = ""
    chat_model_file: str = ""
    chat_mmproj_file: str = ""
    embed_model_file: str = ""
    ctx_size: int = 16384
    gpu_layers: int = 99
    parallel_slots: int = 2
    llama_extra_args: str = ""
    autostart_llm: bool = False

    # Sicurezza
    api_token: str = ""
    session_secret: str = ""
    allowed_hosts: list[str] = field(default_factory=lambda: ["127.0.0.1", "localhost"])
    max_upload_mb: int = 25
    approval_timeout: int = 300
    command_timeout: int = 60

    # Strumenti
    allowed_paths: list[Path] = field(default_factory=list)  # cartelle extra accessibili agli agenti
    searxng_url: str = ""
    browser_headless: bool = True
    web_timeout: int = 20

    @classmethod
    def from_env(cls, env_file: Path | None = None) -> "Settings":
        load_dotenv(env_file or ROOT / ".env")
        e = os.environ.get
        data_dir = _path(e("AILOCALE_DATA_DIR"), ROOT / "data")
        s = cls(
            host=e("AILOCALE_HOST", "127.0.0.1"),
            port=_int(e("AILOCALE_PORT"), 8765),
            data_dir=data_dir,
            models_dir=_path(e("AILOCALE_MODELS_DIR"), ROOT / "models"),
            workspace_dir=_path(e("AILOCALE_WORKSPACE_DIR"), data_dir / "workspace"),
            llm_base_url=e("LLM_BASE_URL", "http://127.0.0.1:8080/v1").rstrip("/"),
            llm_model=e("LLM_MODEL", "local"),
            llm_api_key=e("LLM_API_KEY", ""),
            llm_timeout=_int(e("LLM_TIMEOUT"), 600),
            embed_base_url=e("EMBED_BASE_URL", "http://127.0.0.1:8081/v1").rstrip("/"),
            embed_model=e("EMBED_MODEL", "local-embed"),
            vision_base_url=e("VISION_BASE_URL", "").rstrip("/"),
            vision_model=e("VISION_MODEL", ""),
            strict_local=_bool(e("STRICT_LOCAL"), True),
            llama_server_path=e("LLAMA_SERVER_PATH", ""),
            chat_model_file=e("CHAT_MODEL_FILE", ""),
            chat_mmproj_file=e("CHAT_MMPROJ_FILE", ""),
            embed_model_file=e("EMBED_MODEL_FILE", ""),
            ctx_size=_int(e("LLAMA_CTX_SIZE"), 16384),
            gpu_layers=_int(e("LLAMA_GPU_LAYERS"), 99),
            parallel_slots=_int(e("LLAMA_PARALLEL"), 2),
            llama_extra_args=e("LLAMA_EXTRA_ARGS", ""),
            autostart_llm=_bool(e("LLAMA_AUTOSTART"), False),
            api_token=e("AILOCALE_API_TOKEN", ""),
            session_secret=e("AILOCALE_SESSION_SECRET", ""),
            allowed_hosts=[h.strip() for h in e("AILOCALE_ALLOWED_HOSTS", "127.0.0.1,localhost").split(",") if h.strip()],
            max_upload_mb=_int(e("AILOCALE_MAX_UPLOAD_MB"), 25),
            approval_timeout=_int(e("AILOCALE_APPROVAL_TIMEOUT"), 300),
            command_timeout=_int(e("AILOCALE_COMMAND_TIMEOUT"), 60),
            allowed_paths=[Path(p.strip()).expanduser() for p in e("AILOCALE_ALLOWED_PATHS", "").split(";") if p.strip()],
            searxng_url=e("SEARXNG_URL", "").rstrip("/"),
            browser_headless=_bool(e("BROWSER_HEADLESS"), True),
            web_timeout=_int(e("WEB_TIMEOUT"), 20),
        )
        if not s.session_secret:
            # Segreto casuale per processo: le sessioni remote scadono al riavvio.
            s.session_secret = secrets.token_hex(32)
        return s

    def ensure_dirs(self) -> None:
        for p in (self.data_dir, self.workspace_dir, self.models_dir, self.data_dir / "uploads",
                  self.data_dir / "documents", self.data_dir / "backups", self.data_dir / "logs",
                  self.data_dir / "trash", self.data_dir / "file-backups"):
            p.mkdir(parents=True, exist_ok=True)

    @property
    def roots(self) -> list[Path]:
        """Cartelle in cui gli agenti possono lavorare: workspace + quelle autorizzate nel .env."""
        return [self.workspace_dir.resolve()] + [p.resolve() for p in self.allowed_paths if p.exists()]

    @property
    def db_path(self) -> Path:
        return self.data_dir / "ailocale.db"


# Impostazioni modificabili dall'interfaccia: chiave -> (default, tipo, min, max)
TUNABLES: dict[str, tuple[Any, type, Any, Any]] = {
    "temperature": (0.4, float, 0.0, 1.5),
    "max_tool_steps": (6, int, 1, 15),
    "max_tasks": (5, int, 1, 8),
    "parallel_agents": (2, int, 1, 4),
    "critic_enabled": (True, bool, None, None),
    "max_revisions": (2, int, 0, 3),
    "disable_thinking": (False, bool, None, None),
    "history_messages": (8, int, 0, 30),
    "rag_top_k": (5, int, 1, 12),
    "max_tokens": (2048, int, 256, 8192),
    "web_access": (True, bool, None, None),
    # Modalità autonoma: le azioni rischiose le approva il Critico (garante) invece dell'utente.
    # Restano sempre attivi i blocchi fissi (comandi distruttivi, cartelle autorizzate, cestino, backup)
    # e l'invio di moduli sui siti web chiede comunque all'utente.
    "autonomous_mode": (False, bool, None, None),
}


def coerce_tunable(key: str, value: Any) -> Any:
    if key not in TUNABLES:
        raise KeyError(key)
    default, typ, lo, hi = TUNABLES[key]
    if typ is bool:
        if isinstance(value, bool):
            return value
        return _bool(str(value), default)
    v = typ(value)
    if lo is not None and v < lo:
        v = lo
    if hi is not None and v > hi:
        v = hi
    return v
