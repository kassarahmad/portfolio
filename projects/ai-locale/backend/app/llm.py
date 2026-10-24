"""Client per server LLM compatibili con l'API OpenAI (llama-server, LM Studio, vLLM...).

Gestisce streaming, tool calling nativo, modalità JSON, rimozione dei blocchi
<think> dei modelli "reasoning" e un fallback per i modelli che scrivono le
chiamate agli strumenti come testo (<tool_call>{...}</tool_call>).
"""
from __future__ import annotations

import json
import re
import time
import uuid
from dataclasses import dataclass, field
from typing import Any, Awaitable, Callable, Protocol

try:  # httpx è la dipendenza ufficiale; httpx2 è un fork compatibile
    import httpx
except ImportError:  # pragma: no cover
    import httpx2 as httpx  # type: ignore

TokenCallback = Callable[[str], Awaitable[None]]


class LLMError(Exception):
    pass


@dataclass
class ToolCall:
    id: str
    name: str
    arguments: dict[str, Any]
    raw_arguments: str = ""


@dataclass
class ChatResult:
    content: str
    tool_calls: list[ToolCall] = field(default_factory=list)
    reasoning: str = ""
    prompt_tokens: int = 0
    completion_tokens: int = 0
    seconds: float = 0.0

    @property
    def tokens_per_second(self) -> float:
        return self.completion_tokens / self.seconds if self.seconds > 0 else 0.0


class ChatModel(Protocol):
    async def chat(self, messages: list[dict], *, tools: list[dict] | None = None,
                   temperature: float = 0.4, json_mode: bool = False,
                   on_token: TokenCallback | None = None, max_tokens: int | None = None) -> ChatResult: ...


class ThinkFilter:
    """Rimuove in streaming il testo dentro <think>...</think>."""

    OPEN, CLOSE = "<think>", "</think>"

    def __init__(self) -> None:
        self.inside = False
        self.buffer = ""
        self.reasoning = ""

    def feed(self, chunk: str) -> str:
        self.buffer += chunk
        out = []
        while self.buffer:
            tag = self.CLOSE if self.inside else self.OPEN
            pos = self.buffer.find(tag)
            if pos >= 0:
                before = self.buffer[:pos]
                if self.inside:
                    self.reasoning += before
                else:
                    out.append(before)
                self.buffer = self.buffer[pos + len(tag):]
                self.inside = not self.inside
                continue
            # tieni da parte un possibile tag spezzato a fine chunk
            keep = 0
            for k in range(1, len(tag)):
                if self.buffer.endswith(tag[:k]):
                    keep = k
            emit = self.buffer[:len(self.buffer) - keep] if keep else self.buffer
            if self.inside:
                self.reasoning += emit
            else:
                out.append(emit)
            self.buffer = self.buffer[len(emit):]
            break
        return "".join(out)

    def flush(self) -> str:
        rest, self.buffer = self.buffer, ""
        if self.inside:
            self.reasoning += rest
            return ""
        return rest


_TOOL_TAG = re.compile(r"<tool_call>\s*(\{.*?\})\s*</tool_call>", re.DOTALL)


def parse_text_tool_calls(content: str) -> tuple[str, list[ToolCall]]:
    """Fallback: estrae chiamate scritte come testo nel formato <tool_call>{...}</tool_call>."""
    calls: list[ToolCall] = []
    for m in _TOOL_TAG.finditer(content):
        try:
            obj = json.loads(m.group(1))
        except json.JSONDecodeError:
            continue
        name = obj.get("name") or obj.get("tool")
        args = obj.get("arguments") or obj.get("args") or {}
        if isinstance(args, str):
            try:
                args = json.loads(args)
            except json.JSONDecodeError:
                args = {}
        if name:
            calls.append(ToolCall(id="call_" + uuid.uuid4().hex[:8], name=name, arguments=args, raw_arguments=json.dumps(args)))
    if calls:
        content = _TOOL_TAG.sub("", content).strip()
    return content, calls


def extract_json(text: str) -> Any:
    """Estrae il primo oggetto JSON valido da un testo (tollerante a ```json e testo extra)."""
    text = re.sub(r"<think>.*?</think>", "", text, flags=re.DOTALL).strip()
    fence = re.search(r"```(?:json)?\s*(.*?)```", text, re.DOTALL)
    candidates = [fence.group(1)] if fence else []
    candidates.append(text)
    for cand in candidates:
        cand = cand.strip()
        try:
            return json.loads(cand)
        except json.JSONDecodeError:
            pass
        start = cand.find("{")
        while start >= 0:
            depth, in_str, esc = 0, False, False
            for i in range(start, len(cand)):
                ch = cand[i]
                if in_str:
                    if esc:
                        esc = False
                    elif ch == "\\":
                        esc = True
                    elif ch == '"':
                        in_str = False
                elif ch == '"':
                    in_str = True
                elif ch == "{":
                    depth += 1
                elif ch == "}":
                    depth -= 1
                    if depth == 0:
                        try:
                            return json.loads(cand[start:i + 1])
                        except json.JSONDecodeError:
                            break
            start = cand.find("{", start + 1)
    raise ValueError("nessun JSON valido nella risposta del modello")


class LLMClient:
    def __init__(self, base_url: str, model: str, api_key: str = "", timeout: float = 600,
                 transport: Any = None):
        self.base_url = base_url.rstrip("/")
        self.model = model
        self.force_vision = False  # forza la capacità visione se il server non la dichiara
        headers = {"Authorization": f"Bearer {api_key}"} if api_key else {}
        self._client = httpx.AsyncClient(
            timeout=httpx.Timeout(timeout, connect=5.0), headers=headers, transport=transport)

    async def aclose(self) -> None:
        await self._client.aclose()

    @property
    def root_url(self) -> str:
        return self.base_url[:-3] if self.base_url.endswith("/v1") else self.base_url

    async def chat(self, messages: list[dict], *, tools: list[dict] | None = None,
                   temperature: float = 0.4, json_mode: bool = False,
                   on_token: TokenCallback | None = None, max_tokens: int | None = None) -> ChatResult:
        payload: dict[str, Any] = {
            "model": self.model,
            "messages": messages,
            "temperature": temperature,
            "stream": True,
            "stream_options": {"include_usage": True},
        }
        if max_tokens:
            payload["max_tokens"] = max_tokens
        if tools:
            payload["tools"] = tools
            payload["tool_choice"] = "auto"
        if json_mode:
            payload["response_format"] = {"type": "json_object"}

        started = time.perf_counter()
        if tools:
            try:
                return await self._chat_stream(payload, tools, json_mode, on_token, started)
            except LLMError as exc:
                # alcune build di llama-server non supportano streaming + tools: riprova senza streaming
                if "ha risposto 4" not in str(exc) and "ha risposto 5" not in str(exc):
                    raise
                return await self._chat_once({**payload, "stream": False}, started)
        return await self._chat_stream(payload, tools, json_mode, on_token, started)

    async def _chat_once(self, payload: dict, started: float) -> ChatResult:
        payload.pop("stream_options", None)
        try:
            resp = await self._client.post(f"{self.base_url}/chat/completions", json=payload)
        except httpx.ConnectError as exc:
            raise LLMError(f"Impossibile collegarsi al server LLM su {self.base_url}. È avviato?") from exc
        if resp.status_code >= 400:
            raise LLMError(f"Il server LLM ha risposto {resp.status_code}: {resp.text[:500]}")
        data = resp.json()
        msg = (data.get("choices") or [{}])[0].get("message") or {}
        think = ThinkFilter()
        content = (think.feed(msg.get("content") or "") + think.flush()).strip()
        calls = []
        for tc in msg.get("tool_calls") or []:
            fn = tc.get("function") or {}
            raw = fn.get("arguments") or ""
            try:
                args = json.loads(raw) if isinstance(raw, str) and raw.strip() else (raw if isinstance(raw, dict) else {})
            except json.JSONDecodeError:
                args = {"_invalid_json": raw}
            if fn.get("name"):
                calls.append(ToolCall(id=tc.get("id") or "call_" + uuid.uuid4().hex[:8], name=fn["name"],
                                      arguments=args, raw_arguments=raw if isinstance(raw, str) else json.dumps(raw)))
        if not calls and "<tool_call>" in content:
            content, calls = parse_text_tool_calls(content)
        usage = data.get("usage") or {}
        return ChatResult(content=content, tool_calls=calls,
                          reasoning=((msg.get("reasoning_content") or "") + think.reasoning).strip(),
                          prompt_tokens=int(usage.get("prompt_tokens", 0) or 0),
                          completion_tokens=int(usage.get("completion_tokens", 0) or 0),
                          seconds=time.perf_counter() - started)

    async def _chat_stream(self, payload: dict, tools: list[dict] | None, json_mode: bool,
                           on_token: TokenCallback | None, started: float) -> ChatResult:
        think = ThinkFilter()
        content_parts: list[str] = []
        reasoning_parts: list[str] = []
        tool_acc: dict[int, dict[str, str]] = {}
        usage: dict[str, int] = {}

        try:
            async with self._client.stream("POST", f"{self.base_url}/chat/completions", json=payload) as resp:
                if resp.status_code >= 400:
                    body = (await resp.aread()).decode("utf-8", "replace")[:500]
                    raise LLMError(f"Il server LLM ha risposto {resp.status_code}: {body}")
                async for line in resp.aiter_lines():
                    line = line.strip()
                    if not line.startswith("data:"):
                        continue
                    data = line[5:].strip()
                    if data == "[DONE]":
                        break
                    try:
                        chunk = json.loads(data)
                    except json.JSONDecodeError:
                        continue
                    if chunk.get("usage"):
                        usage = chunk["usage"]
                    for choice in chunk.get("choices") or []:
                        delta = choice.get("delta") or {}
                        if delta.get("reasoning_content"):
                            reasoning_parts.append(delta["reasoning_content"])
                        if delta.get("content"):
                            visible = think.feed(delta["content"])
                            if visible:
                                content_parts.append(visible)
                                if on_token and not tools and not json_mode:
                                    await on_token(visible)
                        for tc in delta.get("tool_calls") or []:
                            slot = tool_acc.setdefault(tc.get("index", 0), {"id": "", "name": "", "args": ""})
                            if tc.get("id"):
                                slot["id"] = tc["id"]
                            fn = tc.get("function") or {}
                            if fn.get("name"):
                                slot["name"] += fn["name"]
                            if fn.get("arguments"):
                                slot["args"] += fn["arguments"]
        except httpx.ConnectError as exc:
            raise LLMError(f"Impossibile collegarsi al server LLM su {self.base_url}. È avviato?") from exc
        except httpx.TimeoutException as exc:
            raise LLMError("Il server LLM non ha risposto in tempo") from exc

        tail = think.flush()
        if tail:
            content_parts.append(tail)
            if on_token and not tools and not json_mode:
                await on_token(tail)
        content = "".join(content_parts).strip()

        calls: list[ToolCall] = []
        for _, slot in sorted(tool_acc.items()):
            if not slot["name"]:
                continue
            try:
                args = json.loads(slot["args"]) if slot["args"].strip() else {}
                if not isinstance(args, dict):
                    args = {"value": args}
            except json.JSONDecodeError:
                args = {"_invalid_json": slot["args"]}
            calls.append(ToolCall(id=slot["id"] or "call_" + uuid.uuid4().hex[:8],
                                  name=slot["name"], arguments=args, raw_arguments=slot["args"]))
        if tools and not calls and "<tool_call>" in content:
            content, calls = parse_text_tool_calls(content)

        return ChatResult(
            content=content,
            tool_calls=calls,
            reasoning=("".join(reasoning_parts) + think.reasoning).strip(),
            prompt_tokens=int(usage.get("prompt_tokens", 0) or 0),
            completion_tokens=int(usage.get("completion_tokens", 0) or 0),
            seconds=time.perf_counter() - started,
        )

    async def embed(self, texts: list[str]) -> list[list[float]]:
        try:
            resp = await self._client.post(f"{self.base_url}/embeddings",
                                           json={"model": self.model, "input": texts})
        except httpx.ConnectError as exc:
            raise LLMError(f"Server di embedding non raggiungibile su {self.base_url}") from exc
        if resp.status_code >= 400:
            raise LLMError(f"Errore embedding {resp.status_code}: {resp.text[:300]}")
        data = resp.json().get("data") or []
        data.sort(key=lambda d: d.get("index", 0))
        return [d["embedding"] for d in data]

    async def health(self) -> dict:
        """Stato reale del server: raggiungibile/no e, se disponibili, info sul modello."""
        info: dict[str, Any] = {"url": self.base_url, "ok": False}
        try:
            r = await self._client.get(f"{self.root_url}/health", timeout=3.0)
            info["ok"] = r.status_code == 200
            info["status"] = r.status_code
        except Exception as exc:  # noqa: BLE001
            info["error"] = type(exc).__name__
            return info
        try:
            r = await self._client.get(f"{self.base_url}/models", timeout=3.0)
            if r.status_code == 200:
                info["models"] = [m.get("id") for m in r.json().get("data", [])]
        except Exception:  # noqa: BLE001
            pass
        try:
            r = await self._client.get(f"{self.root_url}/props", timeout=3.0)
            if r.status_code == 200:
                props = r.json()
                info["model_path"] = props.get("model_path")
                gen = props.get("default_generation_settings") or {}
                info["n_ctx"] = gen.get("n_ctx") or props.get("n_ctx")
                info["total_slots"] = props.get("total_slots")
                mods = props.get("modalities") or {}
                info["vision"] = bool(mods.get("vision")) or self.force_vision
        except Exception:  # noqa: BLE001
            pass
        return info
