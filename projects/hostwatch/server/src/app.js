import crypto from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createSession, hostForToken, readCookie, verifyPassword, verifySession } from "./auth.js";
import { validateSample } from "./ingest.js";
import { createRateLimiter } from "./lib/rate-limit.js";

const PUBLIC = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "public");
const STATIC = {
  "/": ["index.html", "text/html; charset=utf-8"],
  "/app.js": ["app.js", "text/javascript; charset=utf-8"],
  "/styles.css": ["styles.css", "text/css; charset=utf-8"],
};
const HEADERS = {
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "X-Frame-Options": "DENY",
  "Content-Security-Policy":
    "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
};
const COOKIE = "hw_session";
const RANGES = { "1h": 3_600_000, "6h": 21_600_000, "24h": 86_400_000, "48h": 172_800_000 };

/** Severity of a host for the overview: silent > critical > warning > ok. */
export function hostStatus(host, openAlerts, now = Date.now(), silentAfterMs = 60_000) {
  if (now - Date.parse(host.lastSeen) > silentAfterMs) return "silent";
  const mine = openAlerts.filter((a) => a.host === host.name);
  if (mine.some((a) => a.severity === "critical")) return "critical";
  if (mine.length) return "warning";
  return "ok";
}

export function createApp({ config, store, engine, hub, log }) {
  const loginLimit = createRateLimiter({ limit: 5, windowMs: 60_000 });
  const ingestLimit = createRateLimiter({ limit: 120, windowMs: 60_000 });
  const silentRule = config.rules.find((r) => r.type === "stale");
  const silentMs = (silentRule?.afterSec ?? 60) * 1000;

  const summary = () => {
    const open = store.openAlerts();
    return {
      hosts: store.hosts().map((h) => ({ ...h, status: hostStatus(h, open, Date.now(), silentMs) })),
      alerts: open,
    };
  };

  const ip = (req) =>
    config.trustProxy && req.headers["x-forwarded-for"]
      ? String(req.headers["x-forwarded-for"]).split(",").at(-1).trim()
      : req.socket.remoteAddress || "unknown";

  function send(res, status, body, extra = {}) {
    const payload = body === undefined ? "" : JSON.stringify(body);
    res.writeHead(status, {
      ...HEADERS,
      "Cache-Control": "no-store",
      ...(payload ? { "Content-Type": "application/json" } : {}),
      ...extra,
    });
    res.end(payload);
  }
  const fail = (res, status, code, message, extra) => send(res, status, { error: { code, message } }, extra);

  async function body(req, max = 64 * 1024) {
    if (!String(req.headers["content-type"] || "").startsWith("application/json"))
      return { error: [415, "Send JSON."] };
    let size = 0;
    const chunks = [];
    for await (const c of req) {
      size += c.length;
      if (size > max) return { error: [413, "Body too large."] };
      chunks.push(c);
    }
    try {
      return { value: JSON.parse(Buffer.concat(chunks).toString("utf8")) };
    } catch {
      return { error: [400, "Body is not valid JSON."] };
    }
  }

  const signedIn = (req) => verifySession(readCookie(req.headers.cookie, COOKIE), config.sessionSecret);
  // Browsers always send Origin on cross-site POSTs; refuse those for session endpoints.
  const sameOrigin = (req) => {
    const o = req.headers.origin;
    if (!o) return true;
    return URL.canParse(o) && new URL(o).host === req.headers.host;
  };
  const cookie = (value, maxAgeSec) =>
    [
      `${COOKIE}=${value}`,
      "Path=/",
      "HttpOnly",
      "SameSite=Strict",
      `Max-Age=${maxAgeSec}`,
      config.cookieSecure ? "Secure" : null,
    ]
      .filter(Boolean)
      .join("; ");

  return async function handle(req, res) {
    const started = Date.now();
    const requestId = crypto.randomUUID();
    const url = new URL(req.url, "http://local");
    const p = url.pathname;
    res.setHeader("X-Request-Id", requestId);
    res.on("finish", () => {
      if (p === "/api/v1/ingest" && res.statusCode === 202) return; // don't log every sample at info level
      log.info("request", {
        requestId,
        method: req.method,
        path: p,
        status: res.statusCode,
        durationMs: Date.now() - started,
      });
    });

    try {
      if (req.method === "GET" && STATIC[p]) {
        const [file, type] = STATIC[p];
        res.writeHead(200, { ...HEADERS, "Content-Type": type, "Cache-Control": "no-cache" });
        return res.end(await readFile(path.join(PUBLIC, file)));
      }

      if (p === "/api/v1/health" && req.method === "GET") return send(res, 200, { status: "ok" });

      if (p === "/api/v1/ingest" && req.method === "POST") {
        const auth = /^Bearer (.+)$/.exec(req.headers.authorization || "")?.[1];
        const allowedHost = hostForToken(config.agentTokens, auth);
        if (!allowedHost) return fail(res, 401, "unauthorized", "Unknown agent token.");
        const lim = ingestLimit.take(allowedHost);
        if (!lim.ok)
          return fail(res, 429, "rate_limited", "Too many samples.", { "Retry-After": String(lim.retryAfterSec) });
        const b = await body(req);
        if (b.error) return fail(res, b.error[0], "bad_request", b.error[1]);
        const v = validateSample(b.value);
        if (!v.ok)
          return send(res, 422, {
            error: { code: "validation_failed", message: "Sample is invalid.", details: v.errors },
          });
        if (v.value.host !== allowedHost)
          return fail(res, 403, "forbidden", "This token can only report for its own host.");
        const row = store.addSample(v.value);
        engine.onSample(v.value.host, v.value, row);
        const open = store.openAlerts();
        const host = store.host(v.value.host);
        hub.broadcast("sample", {
          host: { ...host, status: hostStatus(host, open, Date.now(), silentMs) },
          point: row,
        });
        return send(res, 202);
      }

      if (p === "/api/v1/login" && req.method === "POST") {
        if (!sameOrigin(req)) return fail(res, 403, "forbidden", "Cross-site request refused.");
        const lim = loginLimit.take(ip(req));
        if (!lim.ok)
          return fail(res, 429, "rate_limited", "Too many attempts. Wait a minute.", {
            "Retry-After": String(lim.retryAfterSec),
          });
        const b = await body(req, 4096);
        if (b.error) return fail(res, b.error[0], "bad_request", b.error[1]);
        const pw = b.value?.password;
        if (typeof pw !== "string" || pw.length > 200 || !verifyPassword(pw, config.passwordHash))
          return fail(res, 401, "unauthorized", "Wrong password.");
        return send(res, 204, undefined, {
          "Set-Cookie": cookie(createSession(config.sessionSecret, config.sessionTtlMs), config.sessionTtlMs / 1000),
        });
      }

      if (p === "/api/v1/logout" && req.method === "POST") {
        if (!sameOrigin(req)) return fail(res, 403, "forbidden", "Cross-site request refused.");
        return send(res, 204, undefined, { "Set-Cookie": cookie("", 0) });
      }

      if (p === "/api/v1/session" && req.method === "GET") return send(res, 200, { authenticated: signedIn(req) });

      // Everything below requires a dashboard session.
      if (!p.startsWith("/api/v1/")) return fail(res, 404, "not_found", "Not found.");
      if (!signedIn(req)) return fail(res, 401, "unauthorized", "Sign in to view metrics.");
      if (req.method !== "GET") return fail(res, 405, "method_not_allowed", "Method not allowed.", { Allow: "GET" });

      if (p === "/api/v1/hosts") return send(res, 200, summary());

      const m = /^\/api\/v1\/hosts\/([^/]+)\/series$/.exec(p);
      if (m) {
        const name = decodeURIComponent(m[1]);
        if (!store.host(name)) return fail(res, 404, "not_found", "Unknown host.");
        const range = url.searchParams.get("range") || "1h";
        if (!RANGES[range])
          return fail(res, 422, "validation_failed", `range must be one of ${Object.keys(RANGES).join(", ")}`);
        const to = Date.now();
        return send(res, 200, { host: name, range, ...store.series(name, to - RANGES[range], to) });
      }

      if (p === "/api/v1/alerts") {
        const state = url.searchParams.get("state") || "open";
        return send(res, 200, { data: state === "open" ? store.openAlerts() : store.recentAlerts(100) });
      }

      if (p === "/api/v1/stream") {
        if (!hub.add(req, res, summary()))
          return fail(res, 503, "busy", "Too many live viewers; the page will poll instead.");
        return;
      }

      return fail(res, 404, "not_found", "Not found.");
    } catch (err) {
      log.error("unhandled error", { requestId, err });
      if (!res.headersSent) fail(res, 500, "internal", "Something went wrong.");
    }
  };
}
