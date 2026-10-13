import http from "node:http";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { loadConfig } from "./config.js";
import { createLogger } from "./lib/log.js";
import { Store } from "./store.js";
import { AlertEngine } from "./alerts.js";
import { SseHub } from "./sse.js";
import { createApp } from "./app.js";

let config;
try {
  config = loadConfig();
} catch (err) {
  process.stderr.write(`${err.message}\n`);
  process.exit(78);
}
const log = createLogger({ level: config.logLevel, base: { service: "hostwatch" } });
if (config.dbFile !== ":memory:") mkdirSync(path.dirname(path.resolve(config.dbFile)), { recursive: true });
const store = new Store(config.dbFile);
const hub = new SseHub({ maxClients: config.maxStreamClients });

async function postWebhook(event) {
  if (!config.webhook) return;
  try {
    const r = await fetch(config.webhook, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ source: "hostwatch", ...event }),
      signal: AbortSignal.timeout(5000),
    });
    if (!r.ok) log.warn("alert webhook failed", { status: r.status });
  } catch (err) {
    log.warn("alert webhook unreachable", { err });
  }
}

const engine = new AlertEngine({
  rules: config.rules,
  store,
  notify: (event) => {
    log.warn("alert", { state: event.state, rule: event.rule, host: event.host, subject: event.subject });
    hub.broadcast("alert", event);
    postWebhook(event);
  },
});

const server = http.createServer(createApp({ config, store, engine, hub, log }));
server.requestTimeout = 30_000;
server.listen(config.port, config.host, () =>
  log.info("listening", { port: config.port, rules: config.rules.map((r) => r.id), agents: config.agentTokens.size }),
);

const tick = setInterval(() => engine.tick(store.hosts()), 15_000);
const prune = setInterval(() => {
  const n = store.prune(config.retentionHours * 3_600_000);
  if (n) log.info("pruned old samples", { count: n });
}, 600_000);

for (const sig of ["SIGTERM", "SIGINT"]) {
  process.on(sig, () => {
    log.info("shutting down", { signal: sig });
    clearInterval(tick);
    clearInterval(prune);
    hub.close();
    server.close(() => {
      store.close();
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 8000).unref();
  });
}
