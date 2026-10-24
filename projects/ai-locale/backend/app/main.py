"""Applicazione web (API + interfaccia) di AI Locale.

Avvio:  python -m backend.app.main     (oppure scripts/start.ps1)
"""
from __future__ import annotations

import asyncio
import contextlib
import json
import logging
import time
from functools import wraps
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

from starlette.applications import Starlette
from starlette.middleware import Middleware
from starlette.requests import Request
from starlette.responses import FileResponse, JSONResponse, Response, StreamingResponse
from starlette.routing import Mount, Route
from starlette.staticfiles import StaticFiles

from .agents import AGENTS, public_agents
from .config import ROOT, TUNABLES, Settings
from .db import Database
from .llm import LLMClient
from .orchestrator import ApprovalManager, Orchestrator, RunManager
from .rag import ALLOWED_EXT, RAG, DocumentError, sanitize_collection
from .security import (SESSION_COOKIE, SESSION_TTL, SecurityMiddleware, sign_session, token_matches)
from .system import (ERRORS, ManagedServer, create_backup, list_backups, list_models, restore_backup,
                     setup_logging, system_metrics, tail_file, vram_fit_warning, gpu_metrics)
from .tools.browser import BrowserSession
from .tools.builtin import build_registry
from .tools.web import WebClient
from .vision import IMAGE_EXT, Vision, sniff_image, tesseract_available

log = logging.getLogger("ailocale.api")
FRONTEND = ROOT / "frontend"
MAX_JSON = 1_000_000
MAX_MESSAGE = 20_000


class ApiError(Exception):
    def __init__(self, status: int, error: str, detail: str | None = None):
        self.status, self.error, self.detail = status, error, detail


def api(handler):
    @wraps(handler)
    async def wrapper(request: Request):
        try:
            result = await handler(request)
        except ApiError as e:
            body = {"error": e.error}
            if e.detail:
                body["detail"] = e.detail
            return JSONResponse(body, status_code=e.status)
        except DocumentError as e:
            return JSONResponse({"error": "invalid_document", "detail": str(e)}, status_code=400)
        except Exception:  # noqa: BLE001
            log.exception("errore API %s %s", request.method, request.url.path)
            return JSONResponse({"error": "internal_error"}, status_code=500)
        if isinstance(result, Response):
            return result
        return JSONResponse(result)
    return wrapper


async def body_json(request: Request) -> dict:
    raw = await request.body()
    if len(raw) > MAX_JSON:
        raise ApiError(413, "payload_too_large")
    if not raw:
        return {}
    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        raise ApiError(400, "invalid_json")
    if not isinstance(data, dict):
        raise ApiError(400, "invalid_json")
    return data


def svc(request: Request) -> Any:
    return request.app.state.svc


def is_local_url(url: str) -> bool:
    import ipaddress
    host = urlparse(url).hostname or ""
    if host in ("localhost",):
        return True
    try:
        ip = ipaddress.ip_address(host)
    except ValueError:
        return host.endswith(".local") or host.endswith(".lan")
    return ip.is_loopback or ip.is_private


class Services:
    def __init__(self, settings: Settings, llm: Any = None, embedder: Any = None, vision_client: Any = None,
                 web_transport: Any = None):
        self.settings = settings
        settings.ensure_dirs()
        self.log_path = setup_logging(settings.data_dir / "logs")
        if settings.strict_local:
            for url in (settings.llm_base_url, settings.embed_base_url, settings.vision_base_url):
                if url and not is_local_url(url):
                    raise ValueError(f"Modalità locale rigorosa attiva: {url} non è un server locale. "
                                     "Imposta STRICT_LOCAL=false nel .env solo se vuoi davvero usare un servizio esterno.")
        self.db = Database(settings.db_path)
        self.llm = llm or LLMClient(settings.llm_base_url, settings.llm_model, settings.llm_api_key, settings.llm_timeout)
        self.embedder = embedder if embedder is not None else LLMClient(
            settings.embed_base_url, settings.embed_model, settings.llm_api_key, 120)
        if vision_client is not None:
            self.vision_client = vision_client
        elif settings.vision_base_url:
            self.vision_client = LLMClient(settings.vision_base_url, settings.vision_model or "vision",
                                           settings.llm_api_key, settings.llm_timeout)
        else:
            self.vision_client = self.llm  # modello chat multimodale (es. Qwen3-VL)
        self.vision = Vision(self.vision_client)
        self.web = WebClient(settings, transport=web_transport)
        self.browser = BrowserSession(settings)
        self.rag = RAG(self.db, settings.data_dir / "documents", self.embedder, self.vision)
        self.tools = build_registry()
        self.approvals = ApprovalManager()
        self.orch = Orchestrator(self.llm, self.tools, self.db, self.rag, settings, self.approvals,
                                 web=self.web, browser=self.browser, vision=self.vision)
        self.runs = RunManager(self.orch, self.db)
        def port_of(url: str, default: int) -> int:
            return urlparse(url).port or default
        self.chat_server = ManagedServer("chat", settings, port_of(settings.llm_base_url, 8080), False,
                                         settings.data_dir / "logs")
        self.embed_server = ManagedServer("embed", settings, port_of(settings.embed_base_url, 8081), True,
                                          settings.data_dir / "logs")
        self.login_failures: dict[str, list[float]] = {}


# ---------------------------------------------------------------------------
# Auth
# ---------------------------------------------------------------------------
@api
async def me(request: Request):
    return {"local": request.state.is_local, "authenticated": request.state.authenticated,
            "remote_enabled": bool(svc(request).settings.api_token)}


@api
async def login(request: Request):
    s = svc(request)
    ip = request.client.host if request.client else "?"
    recent = [t for t in s.login_failures.get(ip, []) if t > time.time() - 300]
    if len(recent) >= 5:
        raise ApiError(429, "too_many_attempts")
    data = await body_json(request)
    if not token_matches(s.settings.api_token, str(data.get("token", ""))):
        s.login_failures[ip] = recent + [time.time()]
        log.warning("login remoto fallito da %s", ip)
        raise ApiError(401, "invalid_token")
    s.login_failures.pop(ip, None)
    expires = int(time.time()) + SESSION_TTL
    resp = JSONResponse({"ok": True})
    resp.set_cookie(SESSION_COOKIE, sign_session(s.settings.session_secret, expires), max_age=SESSION_TTL,
                    httponly=True, samesite="strict", secure=request.url.scheme == "https")
    return resp


@api
async def logout(request: Request):
    resp = JSONResponse({"ok": True})
    resp.delete_cookie(SESSION_COOKIE)
    return resp


# ---------------------------------------------------------------------------
# Conversazioni e chat
# ---------------------------------------------------------------------------
@api
async def conversations(request: Request):
    s = svc(request)
    if request.method == "POST":
        data = await body_json(request)
        return s.db.create_conversation(str(data.get("title") or "Nuova conversazione"))
    return {"items": s.db.list_conversations(request.query_params.get("q", "").strip()[:200])}


@api
async def conversation(request: Request):
    s = svc(request)
    cid = request.path_params["cid"]
    conv = s.db.get_conversation(cid)
    if not conv:
        raise ApiError(404, "not_found")
    if request.method == "DELETE":
        if s.runs.is_busy(cid):
            raise ApiError(409, "run_in_progress")
        s.db.delete_conversation(cid)
        return {"ok": True}
    if request.method == "PATCH":
        data = await body_json(request)
        title = str(data.get("title", "")).strip()
        if not title:
            raise ApiError(400, "title_required")
        s.db.rename_conversation(cid, title)
        return s.db.get_conversation(cid)
    return {**conv, "messages": s.db.messages(cid)}


@api
async def post_message(request: Request):
    s = svc(request)
    cid = request.path_params["cid"]
    if not s.db.get_conversation(cid):
        raise ApiError(404, "not_found")
    data = await body_json(request)
    content = str(data.get("content", "")).strip()
    if not content:
        raise ApiError(400, "empty_message")
    if len(content) > MAX_MESSAGE:
        raise ApiError(413, "message_too_long")
    if s.runs.is_busy(cid):
        raise ApiError(409, "run_in_progress")
    cols = [sanitize_collection(c) for c in (data.get("collections") or []) if isinstance(c, str)][:10]
    attachments = []
    for a in (data.get("attachments") or [])[:6]:
        name = Path(str(a)).name
        if (s.settings.data_dir / "uploads" / name).is_file():
            attachments.append(f"uploads/{name}")
    run_id = await s.runs.start(cid, content, cols, attachments)
    return {"run_id": run_id}


async def run_events(request: Request):
    s = svc(request)
    run_id = request.path_params["rid"]
    if run_id not in s.runs.active and not s.db.get_run(run_id):
        return JSONResponse({"error": "not_found"}, status_code=404)

    async def stream():
        async for ev in s.runs.subscribe(run_id):
            if await request.is_disconnected():
                break
            yield f"data: {json.dumps(ev, ensure_ascii=False)}\n\n"
        yield "data: {\"type\": \"stream_end\", \"data\": {}}\n\n"

    return StreamingResponse(stream(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


@api
async def run_detail(request: Request):
    s = svc(request)
    run = s.db.get_run(request.path_params["rid"])
    if not run:
        raise ApiError(404, "not_found")
    return {**run, "events": s.db.events(run["id"])}


@api
async def cancel_run(request: Request):
    return {"cancelled": svc(request).runs.cancel(request.path_params["rid"])}


@api
async def approvals(request: Request):
    return {"items": svc(request).approvals.list()}


@api
async def resolve_approval(request: Request):
    data = await body_json(request)
    ok = svc(request).approvals.resolve(request.path_params["aid"], bool(data.get("approve")))
    if not ok:
        raise ApiError(404, "approval_not_found")
    return {"ok": True}


@api
async def agents(request: Request):
    return {"items": public_agents()}


# ---------------------------------------------------------------------------
# Documenti (RAG)
# ---------------------------------------------------------------------------
@api
async def documents(request: Request):
    s = svc(request)
    if request.method == "GET":
        return {"items": s.rag.list_documents(), "collections": s.rag.collections(),
                "allowed_extensions": sorted(ALLOWED_EXT), "max_upload_mb": s.settings.max_upload_mb}
    max_bytes = s.settings.max_upload_mb * 1024 * 1024
    length = int(request.headers.get("content-length") or 0)
    if length > max_bytes + 64 * 1024:
        raise ApiError(413, "file_too_large")
    async with request.form(max_files=1, max_fields=5) as form:
        upload = form.get("file")
        if upload is None or isinstance(upload, str):
            raise ApiError(400, "file_required")
        data = await upload.read(max_bytes + 1)
        doc = await s.rag.add_document(upload.filename or "documento", data,
                                       str(form.get("collection") or "generale"), max_bytes)
    return doc


@api
async def document(request: Request):
    s = svc(request)
    if not s.rag.delete_document(int(request.path_params["did"])):
        raise ApiError(404, "not_found")
    return {"ok": True}


@api
async def documents_search(request: Request):
    s = svc(request)
    q = request.query_params.get("q", "").strip()
    if not q:
        raise ApiError(400, "query_required")
    cols = [c for c in request.query_params.getlist("collection") if c]
    return {"items": await s.rag.search(q, cols or None, k=8)}


@api
async def documents_reembed(request: Request):
    return {"documents": await svc(request).rag.reembed_missing()}


# ---------------------------------------------------------------------------
# Memoria
# ---------------------------------------------------------------------------
@api
async def memories(request: Request):
    s = svc(request)
    if request.method == "POST":
        data = await body_json(request)
        content = str(data.get("content", "")).strip()
        if not content:
            raise ApiError(400, "content_required")
        return s.db.add_memory(content, "user")
    return {"items": s.db.list_memories()}


@api
async def memory(request: Request):
    s = svc(request)
    mid = int(request.path_params["mid"])
    if request.method == "DELETE":
        if not s.db.delete_memory(mid):
            raise ApiError(404, "not_found")
        return {"ok": True}
    data = await body_json(request)
    content = str(data.get("content", "")).strip()
    if not content:
        raise ApiError(400, "content_required")
    if not s.db.update_memory(mid, content):
        raise ApiError(404, "not_found")
    return {"ok": True}


# ---------------------------------------------------------------------------
# Impostazioni
# ---------------------------------------------------------------------------
@api
async def settings_api(request: Request):
    s = svc(request)
    if request.method == "PUT":
        data = await body_json(request)
        unknown = [k for k in data if k not in TUNABLES]
        if unknown:
            raise ApiError(400, "unknown_settings", ", ".join(unknown))
        try:
            values = s.db.set_tunables(data)
        except (TypeError, ValueError):
            raise ApiError(400, "invalid_value")
        return {"values": values}
    meta = {k: {"default": v[0], "type": v[1].__name__, "min": v[2], "max": v[3]} for k, v in TUNABLES.items()}
    return {"values": s.db.get_tunables(), "meta": meta}


# ---------------------------------------------------------------------------
# Amministrazione (solo locale: vedi SecurityMiddleware)
# ---------------------------------------------------------------------------
@api
async def admin_system(request: Request):
    s = svc(request)
    metrics = await asyncio.to_thread(system_metrics, s.settings.data_dir)
    llm_h, emb_h = await asyncio.gather(s.llm.health(), s.embedder.health())
    return {"metrics": metrics,
            "services": {"api": {"ok": True}, "llm": llm_h, "embeddings": emb_h,
                         "database": {"ok": True, **s.db.stats()}},
            "managed": {"chat": s.chat_server.status(), "embed": s.embed_server.status()},
            "active_runs": sum(1 for r in s.runs.active.values() if not r.done),
            "pending_approvals": len(s.approvals.pending)}


@api
async def admin_logs(request: Request):
    s = svc(request)
    n = min(1000, max(10, int(request.query_params.get("lines", 200))))
    which = request.query_params.get("source", "app")
    path = {"app": s.log_path, "chat": s.chat_server.log_path, "embed": s.embed_server.log_path}.get(which)
    if path is None:
        raise ApiError(400, "invalid_source")
    return {"source": which, "lines": tail_file(path, n)}


@api
async def admin_errors(request: Request):
    return {"items": list(reversed(ERRORS.records))}


@api
async def admin_models(request: Request):
    s = svc(request)
    return {"models": list_models(s.settings.models_dir), "models_dir": str(s.settings.models_dir),
            "managed_available": s.chat_server.available,
            "chat": s.chat_server.status(), "embed": s.embed_server.status(),
            "config": {"ctx_size": s.settings.ctx_size, "gpu_layers": s.settings.gpu_layers,
                       "parallel_slots": s.settings.parallel_slots}}


@api
async def admin_models_load(request: Request):
    s = svc(request)
    data = await body_json(request)
    target = s.embed_server if data.get("kind") == "embed" else s.chat_server
    file = str(data.get("file", ""))
    model = next((m for m in list_models(s.settings.models_dir) if m["file"] == file), None)
    if not model:
        raise ApiError(404, "model_not_found")
    if not target.available:
        raise ApiError(400, "llama_server_not_configured",
                       "Imposta LLAMA_SERVER_PATH nel file .env per gestire i modelli da qui.")
    warning = None if target.embedding else vram_fit_warning(model["size"], s.settings.ctx_size,
                                                             await asyncio.to_thread(gpu_metrics))
    try:
        status = await target.start(file)
    except RuntimeError as exc:
        raise ApiError(400, "start_failed", str(exc))
    return {"status": status, "warning": warning}


@api
async def admin_models_stop(request: Request):
    s = svc(request)
    data = await body_json(request)
    target = s.embed_server if data.get("kind") == "embed" else s.chat_server
    await target.stop()
    return {"status": target.status()}


@api
async def admin_backups(request: Request):
    s = svc(request)
    if request.method == "POST":
        path = await asyncio.to_thread(create_backup, s.db, s.settings.data_dir)
        return {"created": path.name}
    return {"items": list_backups(s.settings.data_dir)}


@api
async def admin_restore(request: Request):
    s = svc(request)
    data = await body_json(request)
    if data.get("confirm") is not True:
        raise ApiError(400, "confirmation_required")
    if any(not r.done for r in s.runs.active.values()):
        raise ApiError(409, "run_in_progress")
    try:
        return await asyncio.to_thread(restore_backup, s.db, s.settings.data_dir, str(data.get("name", "")))
    except FileNotFoundError:
        raise ApiError(404, "backup_not_found")
    except ValueError as exc:
        raise ApiError(400, "invalid_backup", str(exc))


# ---------------------------------------------------------------------------
# Allegati (immagini in chat)
# ---------------------------------------------------------------------------
@api
async def uploads(request: Request):
    s = svc(request)
    max_bytes = 15 * 1024 * 1024
    if int(request.headers.get("content-length") or 0) > max_bytes + 64 * 1024:
        raise ApiError(413, "file_too_large")
    async with request.form(max_files=1, max_fields=2) as form:
        f = form.get("file")
        if f is None or isinstance(f, str):
            raise ApiError(400, "file_required")
        data = await f.read(max_bytes + 1)
    if len(data) > max_bytes:
        raise ApiError(413, "file_too_large")
    mime = sniff_image(data)
    if not mime:
        raise ApiError(400, "invalid_image", "Sono supportate immagini PNG, JPEG, WEBP e GIF.")
    ext = {"image/png": ".png", "image/jpeg": ".jpg", "image/gif": ".gif", "image/webp": ".webp"}[mime]
    import uuid as _uuid
    name = f"{time.strftime('%Y%m%d')}-{_uuid.uuid4().hex[:10]}{ext}"
    (s.settings.data_dir / "uploads" / name).write_bytes(data)
    return {"name": name, "path": f"uploads/{name}", "size": len(data), "mime": mime}


async def upload_file(request: Request):
    s = svc(request)
    name = Path(request.path_params["name"]).name
    path = s.settings.data_dir / "uploads" / name
    if not path.is_file() or path.suffix.lower() not in IMAGE_EXT:
        return JSONResponse({"error": "not_found"}, status_code=404)
    return FileResponse(path, headers={"Cache-Control": "private, max-age=86400"})


@api
async def tools_api(request: Request):
    s = svc(request)
    tun = s.db.get_tunables()
    vision_ok = await s.vision.available()
    caps = {"web": bool(tun.get("web_access")), "browser": s.browser.available(), "vision": vision_ok,
            "ocr": "tesseract" if tesseract_available() else ("vision" if vision_ok else None)}
    unavailable = {"browser_open": not caps["browser"], "browser_click": not caps["browser"],
                   "browser_type": not caps["browser"], "browser_back": not caps["browser"],
                   "browser_screenshot": not caps["browser"], "analyze_image": not vision_ok}
    items = []
    for t in s.tools.tools.values():
        approval = "sempre" if t.requires_approval is True else ("se sovrascrive/sposta/elimina/invia" if t.risk in ("write", "external") else "no")
        enabled = not unavailable.get(t.name, False) and not (t.risk in ("network", "external") and not caps["web"])
        items.append({"name": t.name, "description": t.description, "risk": t.risk, "approval": approval,
                      "enabled": enabled,
                      "agents": [a.id for a in AGENTS.values() if t.name in a.tools]})
    return {"items": items, "capabilities": caps, "roots": [str(r) for r in s.settings.roots]}


@api
async def admin_audit(request: Request):
    return {"items": svc(request).db.audit_log(300)}


async def index(request: Request):
    return FileResponse(FRONTEND / "index.html", headers={"Cache-Control": "no-cache"})


# ---------------------------------------------------------------------------
def create_app(settings: Settings | None = None, llm: Any = None, embedder: Any = None,
               vision_client: Any = None, web_transport: Any = None) -> Starlette:
    settings = settings or Settings.from_env()
    services = Services(settings, llm=llm, embedder=embedder, vision_client=vision_client,
                        web_transport=web_transport)

    @contextlib.asynccontextmanager
    async def lifespan(app):
        n = services.db.mark_interrupted_runs()
        if n:
            log.warning("%d run interrotti dal riavvio precedente", n)
        if settings.autostart_llm and services.chat_server.available:
            try:
                if settings.chat_model_file:
                    await services.chat_server.start(settings.chat_model_file)
                if settings.embed_model_file:
                    await services.embed_server.start(settings.embed_model_file)
            except RuntimeError as exc:
                log.error("avvio automatico llama-server fallito: %s", exc)
        log.info("AI Locale pronto su http://%s:%s", settings.host, settings.port)
        yield
        await services.chat_server.stop()
        await services.embed_server.stop()
        await services.browser.close()
        await services.web.aclose()
        for client in {id(c): c for c in (services.llm, services.embedder, services.vision_client)}.values():
            if hasattr(client, "aclose"):
                await client.aclose()
        services.db.close()

    routes = [
        Route("/", index),
        Route("/api/me", me),
        Route("/api/login", login, methods=["POST"]),
        Route("/api/logout", logout, methods=["POST"]),
        Route("/api/agents", agents),
        Route("/api/conversations", conversations, methods=["GET", "POST"]),
        Route("/api/conversations/{cid}", conversation, methods=["GET", "PATCH", "DELETE"]),
        Route("/api/conversations/{cid}/messages", post_message, methods=["POST"]),
        Route("/api/runs/{rid}", run_detail),
        Route("/api/runs/{rid}/events", run_events),
        Route("/api/runs/{rid}/cancel", cancel_run, methods=["POST"]),
        Route("/api/approvals", approvals),
        Route("/api/approvals/{aid}", resolve_approval, methods=["POST"]),
        Route("/api/documents", documents, methods=["GET", "POST"]),
        Route("/api/documents/search", documents_search),
        Route("/api/documents/reembed", documents_reembed, methods=["POST"]),
        Route("/api/documents/{did:int}", document, methods=["DELETE"]),
        Route("/api/memory", memories, methods=["GET", "POST"]),
        Route("/api/memory/{mid:int}", memory, methods=["PUT", "DELETE"]),
        Route("/api/settings", settings_api, methods=["GET", "PUT"]),
        Route("/api/admin/system", admin_system),
        Route("/api/admin/logs", admin_logs),
        Route("/api/admin/errors", admin_errors),
        Route("/api/admin/models", admin_models),
        Route("/api/admin/models/load", admin_models_load, methods=["POST"]),
        Route("/api/admin/models/stop", admin_models_stop, methods=["POST"]),
        Route("/api/admin/backups", admin_backups, methods=["GET", "POST"]),
        Route("/api/admin/backups/restore", admin_restore, methods=["POST"]),
        Route("/api/admin/audit", admin_audit),
        Route("/api/uploads", uploads, methods=["POST"]),
        Route("/api/uploads/{name}", upload_file),
        Route("/api/tools", tools_api),
        Mount("/static", StaticFiles(directory=FRONTEND), name="static"),
    ]
    app = Starlette(routes=routes, lifespan=lifespan,
                    middleware=[Middleware(SecurityMiddleware, settings=settings)])
    app.state.svc = services
    return app


def main() -> None:
    import uvicorn
    settings = Settings.from_env()
    if settings.host not in ("127.0.0.1", "localhost", "::1") and not settings.api_token:
        raise SystemExit("Per esporre AI Locale oltre al PC imposta AILOCALE_API_TOKEN nel file .env "
                         "e aggiungi l'host in AILOCALE_ALLOWED_HOSTS (consigliato: solo l'IP Tailscale).")
    try:
        app = create_app(settings)
    except ValueError as exc:
        raise SystemExit(str(exc))
    uvicorn.run(app, host=settings.host, port=settings.port, log_level="warning")


if __name__ == "__main__":
    main()
