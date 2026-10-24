#!/usr/bin/env bash
# AI Locale - avvio su Linux / WSL2 (llama-server va installato a parte, vedi README).
set -euo pipefail
cd "$(dirname "$0")/.."
if [ ! -x .venv/bin/python ]; then
  python3 -m venv .venv
  .venv/bin/pip install -r requirements.txt
fi
[ -f .env ] || cp .env.example .env
exec .venv/bin/python -m backend.app.main
