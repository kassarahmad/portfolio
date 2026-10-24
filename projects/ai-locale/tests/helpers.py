"""Strumenti di test: un modello finto e deterministico che sostituisce llama-server.

Serve SOLO ai test automatici: permette di verificare la logica del motore
multi-agente senza GPU. Non viene mai usato dall'applicazione reale.
"""
from __future__ import annotations

import json
import shutil
import sys
import tempfile
from pathlib import Path
from typing import Callable

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from backend.app.config import Settings  # noqa: E402
from backend.app.llm import ChatResult, ToolCall  # noqa: E402


def role_of(messages: list[dict]) -> str:
    system = messages[0]["content"] if messages and messages[0]["role"] == "system" else ""
    if "Your job now is ONLY to plan" in system:
        return "planner"
    if system.startswith("You are the Critic"):
        return "critic"
    if "Write the final answer to the user" in system or "helpful local AI assistant" in system:
        return "synth"
    if "A colleague (" in system:
        return "consult"
    if system.startswith("You are the Vision"):
        return "vision"
    for name in ("Researcher", "Programmer", "Analyst", "Writer", "Operator", "Navigator"):
        if system.startswith(f"You are the {name}"):
            return name.lower()
    return "unknown"


class FakeLLM:
    """`script(role, messages, call_index) -> ChatResult | str | dict`."""

    def __init__(self, script: Callable[[str, list[dict], int], object], delay: float = 0.0):
        self.script = script
        self.delay = delay
        self.calls: list[tuple[str, list[dict], dict]] = []
        self.counts: dict[str, int] = {}

    async def chat(self, messages, *, tools=None, temperature=0.4, json_mode=False, on_token=None, max_tokens=None):
        role = role_of(messages)
        i = self.counts.get(role, 0)
        self.counts[role] = i + 1
        self.calls.append((role, messages, {"tools": tools, "json_mode": json_mode}))
        if self.delay:
            import asyncio
            await asyncio.sleep(self.delay)
        out = self.script(role, messages, i)
        if isinstance(out, dict):
            out = ChatResult(content=json.dumps(out))
        elif isinstance(out, str):
            out = ChatResult(content=out)
        if on_token and out.content:
            for word in out.content.split(" "):
                await on_token(word + " ")
                if self.delay:
                    import asyncio
                    await asyncio.sleep(self.delay / 20)
        out.completion_tokens = out.completion_tokens or len(out.content.split())
        out.seconds = out.seconds or 0.01
        return out

    async def health(self):
        return {"ok": True, "url": "fake"}

    async def aclose(self):
        pass


class FakeEmbedder:
    """Embedding finto: vettore di frequenza su un piccolo vocabolario."""
    VOCAB = ["pizza", "forno", "legna", "python", "codice", "ancona", "prezzo", "orari", "gpu", "memoria"]

    async def embed(self, texts):
        out = []
        for t in texts:
            low = t.lower()
            out.append([float(low.count(w)) + 0.01 for w in self.VOCAB])
        return out

    async def health(self):
        return {"ok": True, "url": "fake-embed"}

    async def aclose(self):
        pass


def tool_call(name: str, **args) -> ChatResult:
    return ChatResult(content="", tool_calls=[ToolCall(id=f"call_{name}", name=name, arguments=args)])


def temp_settings() -> tuple[Settings, Path]:
    d = Path(tempfile.mkdtemp(prefix="ailocale-test-"))
    s = Settings(data_dir=d / "data", workspace_dir=d / "data" / "workspace", models_dir=d / "models",
                 session_secret="test-secret", api_token="segreto-di-prova", approval_timeout=5,
                 command_timeout=10)
    s.ensure_dirs()
    return s, d


def cleanup(path: Path) -> None:
    shutil.rmtree(path, ignore_errors=True)
