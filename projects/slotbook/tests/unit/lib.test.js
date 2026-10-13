import { test } from "node:test";
import assert from "node:assert/strict";
import { parse, v } from "../../src/lib/validate.js";
import { ApiError } from "../../src/lib/errors.js";
import { hashPassword, signJwt, verifyJwt, verifyPassword } from "../../src/lib/crypto.js";
import { createRateLimiter } from "../../src/lib/rate-limit.js";
import { checkHours } from "../../src/modules/staff.js";
import { loadConfig } from "../../src/config.js";
import { createLogger } from "../../src/lib/log.js";

const SECRET = "x".repeat(40);

test("validator returns cleaned values", () => {
  const s = v.object({ email: v.email(), n: v.int({ min: 1, max: 5, coerce: true }), d: v.optional(v.date()) });
  assert.deepEqual(parse(s, { email: "  A@Example.COM ", n: "3" }), { email: "a@example.com", n: 3 });
});

test("validator reports every problem at once, including unknown fields", () => {
  const s = v.object({ name: v.string({ min: 1 }), age: v.int({ min: 0 }) });
  try {
    parse(s, { name: "", age: -1, role: "owner" });
    assert.fail("should throw");
  } catch (e) {
    assert.ok(e instanceof ApiError);
    assert.equal(e.status, 422);
    const fields = e.details.map((d) => d.field).sort();
    assert.deepEqual(fields, ["age", "name", "role"]);
  }
});

test("dates must be real calendar dates", () => {
  assert.equal(parse(v.date(), "2028-02-29"), "2028-02-29");
  assert.throws(() => parse(v.date(), "2027-02-29"), ApiError);
  assert.throws(() => parse(v.datetime(), "2026-10-13T10:00:00"), ApiError, "time zone is required");
});

test("passwords hash with a random salt and verify", async () => {
  const a = await hashPassword("correct horse battery");
  const b = await hashPassword("correct horse battery");
  assert.notEqual(a, b);
  assert.ok(await verifyPassword("correct horse battery", a));
  assert.equal(await verifyPassword("wrong horse battery", a), false);
  assert.equal(await verifyPassword("x", "not-a-hash"), false);
});

test("JWT: valid, tampered, wrong secret, alg none, expired", () => {
  const t = signJwt({ sub: "u1", role: "customer" }, SECRET, 60);
  assert.equal(verifyJwt(t, SECRET).sub, "u1");
  const [h, , s] = t.split(".");
  const forged = Buffer.from(JSON.stringify({ sub: "u1", role: "owner", iss: "slotbook", exp: 9e9 })).toString(
    "base64url",
  );
  assert.equal(verifyJwt(`${h}.${forged}.${s}`, SECRET), null);
  assert.equal(verifyJwt(t, "y".repeat(40)), null);
  const none = Buffer.from(JSON.stringify({ alg: "none" })).toString("base64url");
  assert.equal(verifyJwt(`${none}.${forged}.`, SECRET), null);
  assert.equal(verifyJwt(signJwt({ sub: "u1" }, SECRET, -1), SECRET), null);
});

test("rate limiter blocks after the limit and resets with the window", () => {
  let now = 0;
  const rl = createRateLimiter({ limit: 2, windowMs: 1000, now: () => now });
  assert.ok(rl.take("a").ok);
  assert.ok(rl.take("a").ok);
  const third = rl.take("a");
  assert.equal(third.ok, false);
  assert.equal(third.retryAfterSec, 1);
  assert.ok(rl.take("b").ok, "keys are independent");
  now = 1000;
  assert.ok(rl.take("a").ok);
});

test("working hours: rejects overlaps and empty intervals, allows a lunch break", () => {
  checkHours([
    { weekday: 1, start: "09:00", end: "13:00" },
    { weekday: 1, start: "14:00", end: "18:00" },
  ]);
  assert.throws(
    () =>
      checkHours([
        { weekday: 1, start: "09:00", end: "13:00" },
        { weekday: 1, start: "12:30", end: "15:00" },
      ]),
    /overlap/,
  );
  assert.throws(() => checkHours([{ weekday: 2, start: "10:00", end: "10:00" }]), /after the start/);
});

test("config fails closed on missing or weak secrets", () => {
  assert.throws(() => loadConfig({ PGUSER: "u", PGDATABASE: "d" }), /JWT_SECRET is required/);
  assert.throws(() => loadConfig({ PGUSER: "u", PGDATABASE: "d", JWT_SECRET: "short" }), /at least 32 bytes/);
  assert.throws(
    () => loadConfig({ PGUSER: "u", PGDATABASE: "d", JWT_SECRET: SECRET, BUSINESS_TZ: "Mars/Base" }),
    /time zone/,
  );
  const c = loadConfig({ PGUSER: "u", PGDATABASE: "d", JWT_SECRET: SECRET });
  assert.equal(c.cookieSecure, true);
  assert.equal(c.trustProxy, false);
});

test("secrets can be read from files", async () => {
  const { mkdtempSync, writeFileSync } = await import("node:fs");
  const { join } = await import("node:path");
  const { tmpdir } = await import("node:os");
  const dir = mkdtempSync(join(tmpdir(), "sb-"));
  writeFileSync(join(dir, "jwt"), `${SECRET}\n`);
  const c = loadConfig({ PGUSER: "u", PGDATABASE: "d", JWT_SECRET_FILE: join(dir, "jwt") });
  assert.equal(c.jwtSecret, SECRET, "trailing newline trimmed");
});

test("logger redacts secret-looking fields", () => {
  const lines = [];
  const log = createLogger({ sink: (l) => lines.push(JSON.parse(l)) });
  log.info("x", { password: "p", authorization: "Bearer t", userId: "u" });
  assert.equal(lines[0].password, "[redacted]");
  assert.equal(lines[0].authorization, "[redacted]");
  assert.equal(lines[0].userId, "u");
});
