import crypto from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Router } from "./http/router.js";
import { ApiError, badRequest, forbidden, fromPg, tooMany, unauthorized } from "./lib/errors.js";
import { verifyJwt } from "./lib/crypto.js";
import { createRateLimiter } from "./lib/rate-limit.js";
import { registerAuth } from "./modules/auth.js";
import { registerMe } from "./modules/me.js";
import { registerServices } from "./modules/services.js";
import { registerStaff } from "./modules/staff.js";
import { registerBookings } from "./modules/bookings.js";
import { openapi } from "./openapi.js";

const PUBLIC_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "public");
const MAX_BODY = 32 * 1024;
const STATIC = {
  "/": ["index.html", "text/html; charset=utf-8"],
  "/app.js": ["app.js", "text/javascript; charset=utf-8"],
  "/styles.css": ["styles.css", "text/css; charset=utf-8"],
  "/docs": ["docs.html", "text/html; charset=utf-8"],
  "/docs.js": ["docs.js", "text/javascript; charset=utf-8"],
};

const SECURITY_HEADERS = {
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "X-Frame-Options": "DENY",
  "Cross-Origin-Opener-Policy": "same-origin",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
  "Content-Security-Policy":
    "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
};

export function createApp({ db, config, log }) {
  const router = new Router("/api/v1");
  const deps = { db, config, log };
  registerAuth(router, deps);
  registerMe(router, deps);
  registerServices(router, deps);
  registerStaff(router, deps);
  registerBookings(router, deps);
  router.get("/health", async () => {
    await db.query("select 1");
    return { status: "ok" };
  });
  router.get("/openapi.json", () => openapi);

  const limiters = {
    auth: createRateLimiter({ limit: config.rateLimit.authPerMin, windowMs: 60_000 }),
    // Session refresh runs on every page load, so it gets its own, looser bucket.
    session: createRateLimiter({ limit: config.rateLimit.sessionPerMin, windowMs: 60_000 }),
    api: createRateLimiter({ limit: config.rateLimit.apiPerMin, windowMs: 60_000 }),
  };

  const clientIp = (req) => {
    if (config.trustProxy) {
      const xff = req.headers["x-forwarded-for"];
      if (xff) return String(xff).split(",").at(-1).trim(); // the hop our proxy appended
    }
    return req.socket.remoteAddress || "unknown";
  };

  async function readJson(req) {
    if (!["POST", "PUT", "PATCH", "DELETE"].includes(req.method)) return undefined;
    const type = req.headers["content-type"] || "";
    const len = Number(req.headers["content-length"] || 0);
    if (len > MAX_BODY) throw new ApiError(413, "payload_too_large", "Request body is too large.");
    const chunks = [];
    let size = 0;
    for await (const c of req) {
      size += c.length;
      if (size > MAX_BODY) throw new ApiError(413, "payload_too_large", "Request body is too large.");
      chunks.push(c);
    }
    if (size === 0) return {};
    if (!type.startsWith("application/json"))
      throw new ApiError(415, "unsupported_media_type", "Send JSON with Content-Type: application/json.");
    try {
      return JSON.parse(Buffer.concat(chunks).toString("utf8"));
    } catch {
      throw badRequest("The request body is not valid JSON.");
    }
  }

  async function authenticate(req) {
    const h = req.headers.authorization;
    if (!h) return null;
    const m = /^Bearer (.+)$/.exec(h);
    if (!m) throw unauthorized("Use a Bearer token.");
    const claims = verifyJwt(m[1], config.jwtSecret);
    if (!claims) throw unauthorized("Your session has expired. Sign in again.");
    // Load the current role so demotions and deletions apply immediately.
    const { rows } = await db.query("select id, email, name, role from users where id = $1", [claims.sub]);
    if (!rows[0]) throw unauthorized("Your session has expired. Sign in again.");
    return rows[0];
  }

  function send(res, status, body, headers = {}) {
    const payload = body === undefined ? "" : JSON.stringify(body);
    res.writeHead(status, {
      ...SECURITY_HEADERS,
      "Cache-Control": "no-store",
      ...(payload ? { "Content-Type": "application/json; charset=utf-8" } : {}),
      ...headers,
    });
    res.end(payload);
  }

  function cors(req, res) {
    const origin = req.headers.origin;
    if (origin && config.corsOrigins.includes(origin)) {
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Access-Control-Allow-Credentials", "true");
      res.setHeader("Vary", "Origin");
      res.setHeader("Access-Control-Allow-Headers", "authorization, content-type, x-request-id");
      res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE");
      res.setHeader("Access-Control-Max-Age", "600");
    }
  }

  async function serveStatic(req, res, pathname) {
    const entry = STATIC[pathname];
    if (!entry || !["GET", "HEAD"].includes(req.method)) return false;
    const body = await readFile(path.join(PUBLIC_DIR, entry[0]));
    res.writeHead(200, { ...SECURITY_HEADERS, "Content-Type": entry[1], "Cache-Control": "no-cache" });
    res.end(req.method === "HEAD" ? undefined : body);
    return true;
  }

  return async function handle(req, res) {
    const started = process.hrtime.bigint();
    const incoming = req.headers["x-request-id"];
    const requestId = typeof incoming === "string" && /^[\w-]{8,64}$/.test(incoming) ? incoming : crypto.randomUUID();
    res.setHeader("X-Request-Id", requestId);
    const url = new URL(req.url, "http://local");
    let user = null;

    res.on("finish", () => {
      const ms = Number(process.hrtime.bigint() - started) / 1e6;
      log.info("request", {
        requestId,
        method: req.method,
        path: url.pathname,
        status: res.statusCode,
        durationMs: Math.round(ms * 10) / 10,
        userId: user?.id,
      });
    });

    try {
      cors(req, res);
      if (req.method === "OPTIONS") return send(res, 204);
      if (!url.pathname.startsWith("/api/")) {
        if (await serveStatic(req, res, url.pathname)) return;
        throw new ApiError(404, "not_found", "Page not found.");
      }
      const m = router.match(req.method, url.pathname);
      if (!m) throw new ApiError(404, "not_found", "No such endpoint.");
      if (m.allowed) {
        return send(
          res,
          405,
          { error: { code: "method_not_allowed", message: "Method not allowed.", requestId } },
          { Allow: m.allowed.join(", ") },
        );
      }
      const { route, params } = m;

      const ip = clientIp(req);
      const lim = limiters[route.bucket]?.take(`${route.bucket}:${ip}`);
      if (lim && !lim.ok) throw tooMany(lim.retryAfterSec);

      user = await authenticate(req);
      if (route.auth) {
        if (!user) throw unauthorized();
        if (Array.isArray(route.auth) && !route.auth.includes(user.role)) throw forbidden();
      }

      const body = await readJson(req);
      const ctx = { req, res, params, query: Object.fromEntries(url.searchParams), body, user, ip, requestId };
      const out = await route.handler(ctx);
      if (res.headersSent) return;
      if (out === undefined) return send(res, 204);
      const status = out?.__status ?? (req.method === "POST" ? 201 : 200);
      const { __status, __headers, ...data } = out ?? {};
      return send(res, status, Array.isArray(out) ? out : data, __headers);
    } catch (err) {
      const e = err instanceof ApiError ? err : fromPg(err);
      if (e) {
        const headers = e.retryAfterSec ? { "Retry-After": String(e.retryAfterSec) } : {};
        return send(
          res,
          e.status,
          { error: { code: e.code, message: e.message, details: e.details, requestId } },
          headers,
        );
      }
      log.error("unhandled error", { requestId, err });
      if (!res.headersSent)
        send(res, 500, { error: { code: "internal", message: "Something went wrong on our side.", requestId } });
    }
  };
}
