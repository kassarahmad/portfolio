"""Registro degli strumenti utilizzabili dagli agenti."""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Awaitable, Callable


class ToolError(Exception):
    """Errore restituito all'agente come risultato dello strumento (non blocca il run)."""


@dataclass
class Tool:
    name: str
    description: str
    parameters: dict[str, Any]
    handler: Callable[..., Awaitable[str]]
    requires_approval: bool = False
    risk: str = "read"  # read | write | exec | network | external
    # Testo mostrato all'utente nella richiesta di approvazione
    preview: Callable[[dict], str] | None = None

    def schema(self) -> dict:
        return {"type": "function",
                "function": {"name": self.name, "description": self.description, "parameters": self.parameters}}


@dataclass
class ToolRegistry:
    tools: dict[str, Tool] = field(default_factory=dict)

    def register(self, tool: Tool) -> None:
        self.tools[tool.name] = tool

    def get(self, name: str) -> Tool | None:
        return self.tools.get(name)

    def schemas(self, names: list[str]) -> list[dict]:
        return [self.tools[n].schema() for n in names if n in self.tools]


def obj(properties: dict[str, Any], required: list[str] | None = None) -> dict:
    return {"type": "object", "properties": properties, "required": required or []}
