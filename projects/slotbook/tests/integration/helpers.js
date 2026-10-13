// Spins up a throwaway database and an app server on a random port.
// Needs a PostgreSQL role that can CREATE DATABASE (PGHOST/PGPORT/PGUSER/PGPASSWORD).
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "../../src/lib/pg/client.js";
import { Pool } from "../../src/lib/pg/pool.js";
import { migrate } from "../../src/db/migrate.js";
import { createApp } from "../../src/app.js";
import { loadConfig } from "../../src/config.js";
import { createLogger } from "../../src/lib/log.js";
import { hashPassword } from "../../src/lib/crypto.js";

const MIGRATIONS = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "migrations");

const admin = () => ({
  host: process.env.PGHOST || "127.0.0.1",
  port: Number(process.env.PGPORT || 5432),
  user: process.env.PGUSER || "postgres",
  password: process.env.PGPASSWORD || "",
  database: "postgres",
});

export async function startTestApp(env = {}) {
  const name = `slotbook_test_${process.pid}_${Date.now()}`;
  const a = new Client(admin());
  await a.connect();
  await a.exec(`create database ${name}`);
  await a.end();

  const dbOpts = { ...admin(), database: name };
  await migrate(dbOpts, MIGRATIONS);
  const config = loadConfig({
    PGUSER: dbOpts.user,
    PGDATABASE: name,
    JWT_SECRET: "test-secret-that-is-at-least-32-bytes-long",
    BUSINESS_TZ: "UTC",
    COOKIE_SECURE: "false",
    LOG_LEVEL: "error",
    ...env,
  });
  const db = new Pool(dbOpts, { max: 5 });
  const logs = [];
  const log = createLogger({ level: "warn", sink: (l) => logs.push(l) });
  const server = http.createServer(createApp({ db, config, log }));
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${server.address().port}`;

  async function call(method, p, { token, body, cookie, headers = {} } = {}) {
    const res = await fetch(base + p, {
      method,
      headers: {
        ...(body !== undefined ? { "content-type": "application/json" } : {}),
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...(cookie ? { cookie } : {}),
        ...headers,
      },
      body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
    });
    const text = await res.text();
    return { status: res.status, headers: res.headers, body: text ? JSON.parse(text) : undefined };
  }

  async function user(email, role = "customer", name = "Test User") {
    const password = "correct-horse-battery";
    if (role === "customer") {
      const r = await call("POST", "/api/v1/auth/register", { body: { email, password, name } });
      return { ...r.body.user, token: r.body.accessToken, cookie: r.headers.get("set-cookie").split(";")[0] };
    }
    await db.query("insert into users (email, password_hash, name, role) values ($1, $2, $3, $4)", [
      email,
      await hashPassword(password),
      name,
      role,
    ]);
    const r = await call("POST", "/api/v1/auth/login", { body: { email, password } });
    return { ...r.body.user, token: r.body.accessToken, cookie: r.headers.get("set-cookie").split(";")[0] };
  }

  async function close() {
    await new Promise((r) => server.close(r));
    await db.end();
    const c = new Client(admin());
    await c.connect();
    await c.exec(`drop database if exists ${name} with (force)`);
    await c.end();
  }

  return { base, call, user, db, close, logs, config };
}

/** A date (YYYY-MM-DD, UTC) `days` from today, and its ISO weekday. */
export function futureDay(days) {
  const d = new Date(Date.now() + days * 86_400_000);
  const iso = d.toISOString().slice(0, 10);
  return { date: iso, weekday: ((d.getUTCDay() + 6) % 7) + 1 };
}
