import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { createApp } from "../src/app.js";
import { Store } from "../src/store.js";
import { AlertEngine } from "../src/alerts.js";
import { SseHub } from "../src/sse.js";
import { loadConfig } from "../src/config.js";
import { hashPassword } from "../src/auth.js";
import { createLogger } from "../src/lib/log.js";
import { sample } from "./fixtures.js";

const WEB = "w".repeat(32);
const DB = "d".repeat(32);
let server, base, hub, cookie;

before(async () => {
  const config = loadConfig({
    HOSTWATCH_SESSION_SECRET: "x".repeat(40),
    HOSTWATCH_PASSWORD_HASH: hashPassword("dashboard-pass-1"),
    HOSTWATCH_AGENT_TOKENS: `web-1=${WEB},db-1=${DB}`,
    COOKIE_SECURE: "false",
  });
  config.rules = [
    {
      id: "cpu-high",
      type: "threshold",
      metric: "cpu",
      above: 90,
      forSec: 0,
      severity: "critical",
      label: "CPU above 90%",
    },
    ...config.rules.filter((r) => r.id !== "cpu-high"),
  ];
  const store = new Store();
  hub = new SseHub({ heartbeatMs: 60_000 });
  const engine = new AlertEngine({ rules: config.rules, store, notify: (e) => hub.broadcast("alert", e) });
  const log = createLogger({ level: "error", sink: () => {} });
  server = http.createServer(createApp({ config, store, engine, hub, log }));
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => {
  hub.close();
  await new Promise((r) => server.close(r));
});

const ingest = (token, body) =>
  fetch(`${base}/api/v1/ingest`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });

test("health is public; data needs a session", async () => {
  assert.equal((await fetch(`${base}/api/v1/health`)).status, 200);
  assert.equal((await fetch(`${base}/api/v1/hosts`)).status, 401);
  assert.equal((await fetch(`${base}/api/v1/stream`)).status, 401);
});

test("login: wrong password, cross-site attempt, then success", async () => {
  const post = (pw, headers = {}) =>
    fetch(`${base}/api/v1/login`, {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify({ password: pw }),
    });
  assert.equal((await post("nope")).status, 401);
  assert.equal((await post("dashboard-pass-1", { origin: "https://evil.example" })).status, 403);
  const ok = await post("dashboard-pass-1");
  assert.equal(ok.status, 204);
  const set = ok.headers.get("set-cookie");
  assert.match(set, /HttpOnly/);
  assert.match(set, /SameSite=Strict/);
  cookie = set.split(";")[0];
});

test("ingest: token checks, host binding and validation", async () => {
  assert.equal((await ingest("nope".repeat(8), sample())).status, 401);
  assert.equal((await ingest(DB, sample({ host: "web-1" }))).status, 403, "db-1's token can't report as web-1");
  const bad = await ingest(WEB, sample({ mem: { usedPct: 500 } }));
  assert.equal(bad.status, 422);
  assert.ok((await bad.json()).error.details.length);
  assert.equal((await ingest(WEB, sample())).status, 202);
});

test("hosts and history for a signed-in viewer", async () => {
  const r = await (await fetch(`${base}/api/v1/hosts`, { headers: { cookie } })).json();
  assert.equal(r.hosts[0].name, "web-1");
  assert.equal(r.hosts[0].status, "ok");
  const s = await fetch(`${base}/api/v1/hosts/web-1/series?range=1h`, { headers: { cookie } });
  assert.equal(s.status, 200);
  assert.ok((await s.json()).points.length >= 1);
  assert.equal((await fetch(`${base}/api/v1/hosts/web-1/series?range=1y`, { headers: { cookie } })).status, 422);
  assert.equal((await fetch(`${base}/api/v1/hosts/nope/series`, { headers: { cookie } })).status, 404);
});

/** Opens the SSE stream and collects events until `done(events)` returns true. */
function listen(done, timeoutMs = 3000) {
  return new Promise((resolve, reject) => {
    const events = [];
    const req = http.get(`${base}/api/v1/stream`, { headers: { cookie } }, (res) => {
      assert.equal(res.headers["content-type"], "text/event-stream; charset=utf-8");
      let buf = "";
      res.on("data", (c) => {
        buf += c;
        let i;
        while ((i = buf.indexOf("\n\n")) >= 0) {
          const block = buf.slice(0, i);
          buf = buf.slice(i + 2);
          const ev = /^event: (.+)$/m.exec(block)?.[1];
          const data = /^data: (.+)$/m.exec(block)?.[1];
          if (ev) events.push({ ev, data: JSON.parse(data) });
          if (done(events)) {
            req.destroy();
            resolve(events);
          }
        }
      });
    });
    req.on("error", (e) => (e.code === "ECONNRESET" ? null : reject(e)));
    setTimeout(() => {
      req.destroy();
      reject(new Error(`timed out with ${JSON.stringify(events.map((e) => e.ev))}`));
    }, timeoutMs);
  });
}

test("live stream: snapshot on connect, then samples and alerts as they arrive", async () => {
  const got = listen((evs) => evs.some((e) => e.ev === "alert") && evs.some((e) => e.ev === "sample"));
  await new Promise((r) => setTimeout(r, 100)); // let the stream subscribe
  await ingest(WEB, sample({ cpu: { usagePct: 97, cores: 2 } }));
  const evs = await got;
  assert.equal(evs[0].ev, "snapshot");
  const s = evs.find((e) => e.ev === "sample");
  assert.equal(s.data.point.cpu, 97);
  const a = evs.find((e) => e.ev === "alert");
  assert.equal(a.data.state, "firing");
  assert.equal(a.data.rule, "cpu-high");
  assert.equal(hub.size >= 0, true);
});

test("disconnected clients are removed from the hub", async () => {
  await listen((evs) => evs.length >= 1);
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(hub.size, 0);
});

test("the open alert shows on the overview and clears when CPU recovers", async () => {
  let r = await (await fetch(`${base}/api/v1/hosts`, { headers: { cookie } })).json();
  assert.equal(r.hosts[0].status, "critical");
  await ingest(WEB, sample({ cpu: { usagePct: 12, cores: 2 } }));
  r = await (await fetch(`${base}/api/v1/hosts`, { headers: { cookie } })).json();
  assert.equal(r.hosts[0].status, "ok");
  const recent = await (await fetch(`${base}/api/v1/alerts?state=recent`, { headers: { cookie } })).json();
  assert.ok(recent.data[0].resolvedAt);
});
