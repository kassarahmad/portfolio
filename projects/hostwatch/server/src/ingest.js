// Validation for samples posted by agents. Strict on shape and ranges so a
// buggy or hostile agent can't store garbage or oversized payloads.

const num = (v, min, max) => typeof v === "number" && Number.isFinite(v) && v >= min && v <= max;
const nullableNum = (v, min, max) => v === null || num(v, min, max);
const str = (v, max) => typeof v === "string" && v.length > 0 && v.length <= max;
const HOST = /^[A-Za-z0-9][A-Za-z0-9._-]{0,62}$/;
const SERVICE_STATES = new Set(["active", "inactive", "failed", "activating", "deactivating", "unknown"]);
const CONTAINER_STATES = new Set([
  "created",
  "running",
  "paused",
  "restarting",
  "removing",
  "exited",
  "dead",
  "unknown",
]);
const HEALTH = new Set(["healthy", "unhealthy", "starting", "none"]);

/** @returns {{ok: boolean, value?: any, errors?: string[]}} */
export function validateSample(s) {
  const e = [];
  const req = (cond, msg) => {
    if (!cond) e.push(msg);
  };
  if (typeof s !== "object" || s === null || Array.isArray(s)) return { ok: false, errors: ["body must be an object"] };
  req(typeof s.host === "string" && HOST.test(s.host), "host must be a hostname (letters, digits, . _ -)");
  req(
    typeof s.ts === "string" && !Number.isNaN(Date.parse(s.ts)) && /Z|[+-]\d\d:\d\d$/.test(s.ts),
    "ts must be an ISO time with a zone",
  );
  req(typeof s.simulated === "boolean", "simulated must be true or false");
  req(Number.isInteger(s.uptimeSec) && s.uptimeSec >= 0, "uptimeSec must be a non-negative integer");
  req(
    Array.isArray(s.load) && s.load.length === 3 && s.load.every((x) => num(x, 0, 10_000)),
    "load must be three numbers",
  );
  req(
    s.cpu &&
      nullableNum(s.cpu.usagePct, 0, 100) &&
      Number.isInteger(s.cpu.cores) &&
      s.cpu.cores > 0 &&
      s.cpu.cores <= 4096,
    "cpu is invalid",
  );
  req(
    s.mem &&
      num(s.mem.totalBytes, 0, 2 ** 53) &&
      num(s.mem.availableBytes, 0, 2 ** 53) &&
      num(s.mem.usedPct, 0, 100) &&
      nullableNum(s.mem.swapUsedPct ?? null, 0, 100),
    "mem is invalid",
  );
  req(
    Array.isArray(s.disks) &&
      s.disks.length <= 20 &&
      s.disks.every(
        (d) =>
          str(d.mount, 200) && num(d.usedPct, 0, 100) && num(d.totalBytes, 0, 2 ** 60) && num(d.usedBytes, 0, 2 ** 60),
      ),
    "disks is invalid",
  );
  req(
    s.net && nullableNum(s.net.rxBytesPerSec, 0, 1e12) && nullableNum(s.net.txBytesPerSec, 0, 1e12),
    "net is invalid",
  );
  req(
    Array.isArray(s.services) &&
      s.services.length <= 50 &&
      s.services.every((x) => str(x.name, 100) && SERVICE_STATES.has(x.state)),
    "services is invalid",
  );
  req(
    Array.isArray(s.containers) &&
      s.containers.length <= 100 &&
      s.containers.every(
        (c) =>
          str(c.name, 100) &&
          typeof c.image === "string" &&
          c.image.length <= 200 &&
          CONTAINER_STATES.has(c.state) &&
          HEALTH.has(c.health),
      ),
    "containers is invalid",
  );
  if (e.length) return { ok: false, errors: e };

  // Rebuild from known fields only: extra properties are dropped, never stored.
  return {
    ok: true,
    value: {
      host: s.host,
      ts: new Date(s.ts).toISOString(),
      simulated: s.simulated,
      uptimeSec: s.uptimeSec,
      load: s.load,
      cpu: { usagePct: s.cpu.usagePct, cores: s.cpu.cores },
      mem: {
        totalBytes: s.mem.totalBytes,
        availableBytes: s.mem.availableBytes,
        usedPct: s.mem.usedPct,
        swapUsedPct: s.mem.swapUsedPct ?? null,
      },
      disks: s.disks.map((d) => ({
        mount: d.mount,
        totalBytes: d.totalBytes,
        usedBytes: d.usedBytes,
        usedPct: d.usedPct,
      })),
      net: { rxBytesPerSec: s.net.rxBytesPerSec, txBytesPerSec: s.net.txBytesPerSec },
      services: s.services.map((x) => ({ name: x.name, state: x.state })),
      containers: s.containers.map((c) => ({ name: c.name, image: c.image, state: c.state, health: c.health })),
    },
  };
}
