"""Sicurezza HTTP: solo locale per default, token per l'accesso remoto, anti-CSRF,
protezione dal DNS rebinding e pannello admin raggiungibile solo dal PC stesso."""
from __future__ import annotations

import hashlib
import hmac
import ipaddress
import time

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import JSONResponse

SESSION_COOKIE = "ailocale_session"
SESSION_TTL = 7 * 24 * 3600
CSRF_HEADER = "x-ailocale"


def is_loopback(host: str | None) -> bool:
    if not host:
        return False
    if host in ("localhost", "testclient"):
        return True
    try:
        return ipaddress.ip_address(host).is_loopback
    except ValueError:
        return False


def sign_session(secret: str, expires: int) -> str:
    sig = hmac.new(secret.encode(), str(expires).encode(), hashlib.sha256).hexdigest()
    return f"{expires}.{sig}"


def verify_session(secret: str, value: str | None) -> bool:
    if not value or "." not in value:
        return False
    exp_s, sig = value.split(".", 1)
    try:
        expires = int(exp_s)
    except ValueError:
        return False
    if expires < time.time():
        return False
    good = hmac.new(secret.encode(), exp_s.encode(), hashlib.sha256).hexdigest()
    return hmac.compare_digest(good, sig)


def token_matches(expected: str, given: str | None) -> bool:
    return bool(expected) and bool(given) and hmac.compare_digest(expected.encode(), given.encode())


class SecurityMiddleware(BaseHTTPMiddleware):
    """Regole applicate a ogni richiesta:

    1. L'header Host deve essere nella lista consentita (difesa dal DNS rebinding).
    2. Le richieste dal PC locale sono ammesse; le altre richiedono una sessione
       ottenuta con il token (`AILOCALE_API_TOKEN`). Senza token configurato,
       l'accesso remoto è disabilitato.
    3. `/api/admin/*` è sempre e solo locale.
    4. Le richieste che modificano dati richiedono l'header `X-AILocale: 1`,
       che un sito esterno non può inviare senza CORS (che non abilitiamo).
    """

    def __init__(self, app, settings):
        super().__init__(app)
        self.settings = settings

    async def dispatch(self, request: Request, call_next):
        s = self.settings
        host_header = (request.headers.get("host") or "").rsplit(":", 1)[0].strip("[]")
        allowed = set(s.allowed_hosts) | {"127.0.0.1", "localhost", "::1"}
        if host_header not in allowed:
            return JSONResponse({"error": "host_not_allowed"}, status_code=421)

        client_host = request.client.host if request.client else None
        local = is_loopback(client_host)
        request.state.is_local = local
        path = request.url.path

        if path.startswith("/api/admin") and not local:
            return JSONResponse({"error": "admin_local_only"}, status_code=403)

        authed = local
        if not local:
            bearer = request.headers.get("authorization", "")
            if bearer.lower().startswith("bearer ") and token_matches(s.api_token, bearer[7:].strip()):
                authed = True
            elif verify_session(s.session_secret, request.cookies.get(SESSION_COOKIE)):
                authed = True
        request.state.authenticated = authed

        public = path in ("/", "/api/login", "/api/me", "/favicon.ico") or path.startswith("/static/")
        if not authed and not public:
            return JSONResponse({"error": "unauthorized"}, status_code=401)

        if request.method in ("POST", "PUT", "PATCH", "DELETE") and path.startswith("/api/"):
            if request.headers.get(CSRF_HEADER) != "1":
                return JSONResponse({"error": "missing_csrf_header"}, status_code=403)

        response = await call_next(request)
        response.headers.setdefault("X-Content-Type-Options", "nosniff")
        response.headers.setdefault("X-Frame-Options", "DENY")
        response.headers.setdefault("Referrer-Policy", "no-referrer")
        response.headers.setdefault(
            "Content-Security-Policy",
            "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; "
            "script-src 'self'; connect-src 'self'; frame-ancestors 'none'")
        return response
