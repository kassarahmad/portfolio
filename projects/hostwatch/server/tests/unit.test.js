import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Store } from "../src/store.js";
import { AlertEngine, DEFAULT_RULES, validateRules } from "../src/alerts.js";
import { validateSample } from "../src/ingest.js";
import {
  createSession,
  hashPassword,
  parseAgentTokens,
  hostForToken,
  verifyPassword,
  verifySession,
} from "../src/auth.js";
import { hostStatus } from "../src/app.js";
import { sample } from "./fixtures.js";

const AGENT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "agent", "hostwatch_agent.py");

test("contract: real agent output (simulated and from /proc) passes server validation", () => {
  for (const args of [
    ["--once", "--simulate", "--host", "sim-1"],
    ["--once", "--host", "real-1"],
  ]) {
    const out = JSON.parse(execFileSync("python3", [AGENT, ...args], { encoding: "utf8" }));
    const v = validateSample(out);
    assert.ok(v.ok, `agent ${args.join(" ")} produced an invalid sample: ${v.errors?.join("; ")}`);
  }
});

test("validation rejects bad shapes and drops unknown fields", () => {
  assert.equal(validateSample(sample({ host: "../etc" })).ok, false);
  assert.equal(validateSample(sample({ cpu: { usagePct: 140, cores: 2 } })).ok, false);
  assert.equal(validateSample(sample({ ts: "yesterday" })).ok, false);
  assert.equal(validateSample(sample({ services: [{ name: "x", state: "exploded" }] })).ok, false);
  const ok = validateSample({ ...sample(), extra: "<script>" });
  assert.ok(ok.ok);
  assert.equal("extra" in ok.value, false);
});

test("store downsamples series into buckets and prunes old data", () => {
  const store = new Store();
  const t0 = Date.parse("2026-01-01T00:00:00Z");
  for (let i = 0; i < 120; i++)
    store.addSample(
      sample({ ts: new Date(t0 + i * 10_000).toISOString(), cpu: { usagePct: i % 2 ? 20 : 40, cores: 2 } }),
      t0 + i * 10_000,
    );
  const s = store.series("web-1", t0, t0 + 1_200_000, 20);
  assert.equal(s.step, 60_000);
  assert.equal(s.points.length, 20);
  assert.equal(s.points[0].cpu, 30, "average of alternating 20/40");
  assert.equal(store.prune(600_000, t0 + 1_200_000), 60);
});

test("threshold alerts wait for the duration, then resolve", () => {
  let now = 0;
  const events = [];
  const store = new Store();
  const rules = [
    {
      id: "cpu-high",
      type: "threshold",
      metric: "cpu",
      above: 90,
      forSec: 60,
      severity: "warning",
      label: "CPU above 90%",
    },
  ];
  const e = new AlertEngine({ rules, store, notify: (x) => events.push(x), now: () => now });
  e.onSample("h", sample(), { cpu: 95 });
  now = 30_000;
  e.onSample("h", sample(), { cpu: 95 });
  assert.equal(events.length, 0, "not yet: only 30 s above");
  now = 61_000;
  e.onSample("h", sample(), { cpu: 96 });
  assert.equal(events.at(-1).state, "firing");
  assert.equal(store.openAlerts().length, 1);
  e.onSample("h", sample(), { cpu: 96 });
  assert.equal(events.length, 1, "no duplicate notifications while firing");
  e.onSample("h", sample(), { cpu: 40 });
  assert.equal(events.at(-1).state, "resolved");
  assert.equal(store.openAlerts().length, 0);
});

test("a brief spike that drops back never fires", () => {
  let now = 0;
  const events = [];
  const rules = [
    { id: "cpu-high", type: "threshold", metric: "cpu", above: 90, forSec: 60, severity: "warning", label: "CPU" },
  ];
  const e = new AlertEngine({ rules, store: new Store(), notify: (x) => events.push(x), now: () => now });
  e.onSample("h", sample(), { cpu: 99 });
  now = 20_000;
  e.onSample("h", sample(), { cpu: 10 });
  now = 90_000;
  e.onSample("h", sample(), { cpu: 99 });
  assert.equal(events.length, 0);
});

test("service alerts are per unit; stale hosts fire on tick; state survives restart", () => {
  const now = 1_000_000;
  const store = new Store();
  const events = [];
  const mk = () => new AlertEngine({ rules: DEFAULT_RULES, store, notify: (x) => events.push(x), now: () => now });
  const e = mk();
  const s = sample({
    services: [
      { name: "a.service", state: "failed" },
      { name: "b.service", state: "active" },
    ],
  });
  e.onSample("h", s, { cpu: 1, mem: 1, disk: 1 });
  assert.deepEqual(
    store.openAlerts().map((a) => a.subject),
    ["a.service"],
  );

  e.tick([{ name: "h", lastSeen: new Date(now - 120_000).toISOString() }]);
  assert.ok(store.openAlerts().some((a) => a.rule === "host-silent"));

  const restarted = mk(); // a new engine over the same store must not re-notify
  const before = events.length;
  restarted.onSample("h", s, { cpu: 1, mem: 1, disk: 1 });
  assert.ok(!events.slice(before).some((x) => x.state === "firing" && x.subject === "a.service"));
  assert.ok(
    events.slice(before).some((x) => x.rule === "host-silent" && x.state === "resolved"),
    "fresh data resolves silence",
  );
});

test("rule files are validated", () => {
  assert.throws(
    () => validateRules([{ id: "x", type: "threshold", metric: "nope", above: 1, forSec: 0, severity: "warning" }]),
    /unknown metric/,
  );
  assert.throws(() => validateRules([{ id: "x", type: "stale", afterSec: 1, severity: "critical" }]), /afterSec/);
  assert.throws(() => validateRules([{ id: "BAD ID", type: "service", severity: "critical" }]), /bad rule id/);
});

test("auth helpers: passwords, sessions, agent tokens", () => {
  const hpw = hashPassword("correct horse battery");
  assert.ok(verifyPassword("correct horse battery", hpw));
  assert.ok(!verifyPassword("wrong", hpw));
  const secret = "s".repeat(40);
  const sess = createSession(secret, 1000, 0);
  assert.ok(verifySession(sess, secret, 500));
  assert.ok(!verifySession(sess, secret, 1500), "expired");
  assert.ok(!verifySession(sess.replace(/^\d+/, "9999999999999"), secret, 500), "tampered expiry");
  const tokens = parseAgentTokens(`web-1=${"a".repeat(32)},db-1=${"b".repeat(32)}`);
  assert.equal(hostForToken(tokens, "b".repeat(32)), "db-1");
  assert.equal(hostForToken(tokens, "c".repeat(32)), null);
  assert.throws(() => parseAgentTokens("web-1=short"), /at least 24/);
});

test("host status ordering", () => {
  const now = Date.now();
  const host = { name: "h", lastSeen: new Date(now).toISOString() };
  assert.equal(hostStatus(host, [], now), "ok");
  assert.equal(hostStatus(host, [{ host: "h", severity: "warning" }], now), "warning");
  assert.equal(
    hostStatus(
      host,
      [
        { host: "h", severity: "warning" },
        { host: "h", severity: "critical" },
      ],
      now,
    ),
    "critical",
  );
  assert.equal(hostStatus({ ...host, lastSeen: new Date(now - 120_000).toISOString() }, [], now), "silent");
});
