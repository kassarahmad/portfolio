"""Comandi da terminale.

    python -m backend.app.cli audit            # verifica hardware e dipendenze (Fase 1)
    python -m backend.app.cli backup           # crea un backup
    python -m backend.app.cli backups          # elenca i backup
    python -m backend.app.cli restore NOME     # ripristina (AI Locale deve essere fermo)
"""
from __future__ import annotations

import importlib
import json
import os
import platform
import sys

from .config import Settings
from .db import Database
from .system import create_backup, gpu_metrics, list_backups, list_models, restore_backup, system_metrics

GB = 1024 ** 3


def audit(settings: Settings) -> int:
    settings.ensure_dirs()
    m = system_metrics(settings.data_dir)
    print("=== AI Locale - Audit hardware ===")
    print(f"Sistema:  {platform.platform()}")
    print(f"Python:   {sys.version.split()[0]}  ({sys.executable})")
    print(f"CPU:      {platform.processor() or '?'}  {m['cpu']['cores_physical']} core / {m['cpu']['cores_logical']} thread")
    print(f"RAM:      {m['ram']['total'] / GB:.1f} GB totali, {m['ram']['available'] / GB:.1f} GB disponibili")
    print(f"Disco:    {m['disk']['free'] / GB:.0f} GB liberi su {m['disk']['total'] / GB:.0f} GB ({settings.data_dir})")
    g = gpu_metrics()
    warnings: list[str] = []
    if g.get("available"):
        for gpu in g["gpus"]:
            print(f"GPU:      {gpu['name']}  VRAM {gpu['vram_total'] / GB:.1f} GB "
                  f"(libera {gpu['vram_free'] / GB:.1f} GB)  driver {g.get('driver')}")
        vram = g["gpus"][0]["vram_total"] / GB
        if vram < 7:
            rec = "Qwen3-4B Q4_K_M (~2.5 GB)"
        elif vram < 11:
            rec = "Qwen3-8B Q4_K_M (~5 GB) con contesto 16k"
        else:
            rec = "Qwen3-14B Q4_K_M (~9 GB) oppure Qwen3-8B Q5/Q6 con più contesto"
        print(f"Modello consigliato: {rec}")
    else:
        print(f"GPU:      non rilevata ({g.get('reason')})")
        warnings.append("Senza GPU NVIDIA i modelli gireranno sulla CPU, molto più lentamente.")
    if m["ram"]["total"] / GB < 20:
        warnings.append("RAM sotto i 20 GB: evita modelli che non entrano interamente in VRAM.")
    if m["disk"]["free"] / GB < 20:
        warnings.append("Meno di 20 GB liberi: i modelli occupano 3-10 GB ciascuno.")

    print("\n=== Dipendenze Python ===")
    for mod in ("starlette", "uvicorn", "httpx", "multipart", "psutil", "numpy", "pypdf", "docx", "pynvml"):
        try:
            importlib.import_module(mod)
            print(f"  ok      {mod}")
        except ImportError:
            print(f"  MANCA   {mod}")
            if mod != "pynvml":
                warnings.append(f"Modulo {mod} mancante: esegui pip install -r requirements.txt")

    print("\n=== Motore LLM ===")
    if settings.llama_server_path:
        print(f"  llama-server: {settings.llama_server_path} "
              f"({'trovato' if os.path.exists(settings.llama_server_path) else 'NON trovato'})")
    else:
        print("  LLAMA_SERVER_PATH non impostato (gestione automatica disattivata)")
    models = list_models(settings.models_dir)
    print(f"  Modelli in {settings.models_dir}: " + (", ".join(f"{x['file']} ({x['size'] / GB:.1f} GB)" for x in models) or "nessuno"))
    if sys.version_info < (3, 11):
        warnings.append("Python 3.11 o superiore consigliato.")
    print("\n=== Avvisi ===")
    print("\n".join(f"  - {w}" for w in warnings) or "  nessuno")
    return 0


def main(argv: list[str] | None = None) -> int:
    argv = argv if argv is not None else sys.argv[1:]
    settings = Settings.from_env()
    if not argv or argv[0] in ("-h", "--help"):
        print(__doc__)
        return 0
    cmd = argv[0]
    if cmd == "audit":
        return audit(settings)
    settings.ensure_dirs()
    db = Database(settings.db_path)
    try:
        if cmd == "backup":
            print(create_backup(db, settings.data_dir))
        elif cmd == "backups":
            print(json.dumps(list_backups(settings.data_dir), indent=2))
        elif cmd == "restore" and len(argv) == 2:
            print(json.dumps(restore_backup(db, settings.data_dir, argv[1]), indent=2))
        else:
            print(__doc__)
            return 2
    finally:
        db.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
