import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig } from "./config.js";
import { createLogger } from "./lib/log.js";
import { Pool } from "./lib/pg/pool.js";
import { migrate } from "./db/migrate.js";
import { createApp } from "./app.js";

const MIGRATIONS = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "migrations");

let config;
try {
  config = loadConfig();
} catch (err) {
  process.stderr.write(`${err.message}\n`);
  process.exit(78); // EX_CONFIG
}
const log = createLogger({ level: config.logLevel, base: { service: "slotbook" } });
const dbOpts = { ...config.db, ssl: config.db.ssl || undefined };
const db = new Pool(dbOpts, { max: config.db.poolMax });

if (process.env.MIGRATE_ON_START !== "false") {
  await migrate(dbOpts, MIGRATIONS, (e) => log.info(e.msg, e));
}

const server = http.createServer(createApp({ db, config, log }));
server.headersTimeout = 15_000;
server.requestTimeout = 30_000;
server.keepAliveTimeout = 5_000;
server.listen(config.port, config.host, () => log.info("listening", { port: config.port, env: config.env }));

// Graceful shutdown: stop accepting, let in-flight requests finish, close the pool.
let stopping = false;
for (const sig of ["SIGTERM", "SIGINT"]) {
  process.on(sig, () => {
    if (stopping) return;
    stopping = true;
    log.info("shutting down", { signal: sig });
    const force = setTimeout(() => process.exit(1), 10_000).unref();
    server.close(async () => {
      await db.end().catch(() => {});
      clearTimeout(force);
      process.exit(0);
    });
    server.closeIdleConnections?.();
  });
}
