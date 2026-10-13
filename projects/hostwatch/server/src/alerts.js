/**
 * Alert rules. A threshold rule fires when a metric stays past its threshold
 * for `forSec` seconds and resolves when it drops back. Stale, service and
 * container rules fire immediately. Each (rule, host, subject) pair is one
 * alert, so a host with two failed services gets two alerts.
 */

export const DEFAULT_RULES = [
  {
    id: "cpu-high",
    type: "threshold",
    metric: "cpu",
    above: 90,
    forSec: 300,
    severity: "warning",
    label: "CPU above 90%",
  },
  {
    id: "mem-high",
    type: "threshold",
    metric: "mem",
    above: 90,
    forSec: 300,
    severity: "warning",
    label: "Memory above 90%",
  },
  {
    id: "disk-high",
    type: "threshold",
    metric: "disk",
    above: 85,
    forSec: 0,
    severity: "critical",
    label: "Disk above 85%",
  },
  { id: "host-silent", type: "stale", afterSec: 60, severity: "critical", label: "No data for 60 seconds" },
  { id: "service-down", type: "service", severity: "critical", label: "Service not active" },
  { id: "container-unhealthy", type: "container", severity: "warning", label: "Container unhealthy or stopped" },
];

const METRICS = new Set(["cpu", "mem", "swap", "load1", "disk"]);

export function validateRules(rules) {
  if (!Array.isArray(rules) || rules.length > 50) throw new Error("rules must be a list of at most 50 rules");
  const ids = new Set();
  for (const r of rules) {
    if (typeof r.id !== "string" || !/^[a-z0-9-]{1,40}$/.test(r.id)) throw new Error(`bad rule id ${r.id}`);
    if (ids.has(r.id)) throw new Error(`duplicate rule id ${r.id}`);
    ids.add(r.id);
    if (!["warning", "critical"].includes(r.severity))
      throw new Error(`rule ${r.id}: severity must be warning or critical`);
    if (r.type === "threshold") {
      if (!METRICS.has(r.metric)) throw new Error(`rule ${r.id}: unknown metric ${r.metric}`);
      if (typeof r.above !== "number") throw new Error(`rule ${r.id}: "above" must be a number`);
      if (!Number.isInteger(r.forSec) || r.forSec < 0) throw new Error(`rule ${r.id}: forSec must be >= 0`);
    } else if (r.type === "stale") {
      if (!Number.isInteger(r.afterSec) || r.afterSec < 10) throw new Error(`rule ${r.id}: afterSec must be >= 10`);
    } else if (!["service", "container"].includes(r.type)) {
      throw new Error(`rule ${r.id}: unknown type ${r.type}`);
    }
  }
  return rules;
}

export class AlertEngine {
  /**
   * @param {{rules: any[], store: import("./store.js").Store, notify?: (event: any) => void, now?: () => number}} opts
   */
  constructor({ rules, store, notify = () => {}, now = () => Date.now() }) {
    this.rules = validateRules(rules);
    this.store = store;
    this.notify = notify;
    this.now = now;
    this.pending = new Map(); // key -> first time the condition was seen
    this.firing = new Set(); // keys currently firing
    for (const a of store.openAlerts()) this.firing.add(key(a.rule, a.host, a.subject)); // survive restarts
  }

  #set(rule, host, subject, active, message, value) {
    const k = key(rule.id, host, subject);
    const t = this.now();
    if (active) {
      if (this.firing.has(k)) return;
      const since = this.pending.get(k) ?? t;
      this.pending.set(k, since);
      if (t - since >= (rule.forSec ?? 0) * 1000) {
        this.firing.add(k);
        this.pending.delete(k);
        this.store.openAlert({ rule: rule.id, host, subject, severity: rule.severity, message, at: t });
        this.notify({
          type: "alert",
          state: "firing",
          rule: rule.id,
          host,
          subject,
          severity: rule.severity,
          message,
          value,
          at: new Date(t).toISOString(),
        });
      }
    } else {
      this.pending.delete(k);
      if (!this.firing.has(k)) return;
      this.firing.delete(k);
      this.store.resolveAlert({ rule: rule.id, host, subject, at: t });
      this.notify({
        type: "alert",
        state: "resolved",
        rule: rule.id,
        host,
        subject,
        severity: rule.severity,
        message: `Resolved: ${message}`,
        at: new Date(t).toISOString(),
      });
    }
  }

  /** Evaluate the rules that depend on a fresh sample. */
  onSample(host, sample, row) {
    for (const r of this.rules) {
      if (r.type === "threshold") {
        const v = row[r.metric];
        if (v === null || v === undefined) continue;
        this.#set(
          r,
          host,
          "",
          v > r.above,
          `${r.label} on ${host} (now ${round(v)}${r.metric === "load1" ? "" : "%"})`,
          v,
        );
      } else if (r.type === "stale") {
        this.#set(r, host, "", false, `${r.label} from ${host}`);
      } else if (r.type === "service") {
        const seen = new Set();
        for (const s of sample.services) {
          seen.add(s.name);
          this.#set(r, host, s.name, s.state !== "active", `${s.name} is ${s.state} on ${host}`);
        }
        this.#resolveMissing(r, host, seen);
      } else if (r.type === "container") {
        const seen = new Set();
        for (const c of sample.containers) {
          seen.add(c.name);
          const bad = c.state !== "running" || c.health === "unhealthy";
          this.#set(
            r,
            host,
            c.name,
            bad,
            `Container ${c.name} on ${host} is ${c.health === "unhealthy" ? "unhealthy" : c.state}`,
          );
        }
        this.#resolveMissing(r, host, seen);
      }
    }
  }

  // A service or container that disappeared from the agent's list is no longer our concern.
  #resolveMissing(rule, host, seen) {
    for (const k of [...this.firing]) {
      const [rid, h, subject] = JSON.parse(k);
      if (rid === rule.id && h === host && !seen.has(subject))
        this.#set(rule, host, subject, false, `${subject} on ${host}`);
    }
  }

  /** Periodic check for hosts that stopped reporting. */
  tick(hosts) {
    const t = this.now();
    for (const r of this.rules.filter((x) => x.type === "stale")) {
      for (const h of hosts) {
        const silent = t - Date.parse(h.lastSeen) > r.afterSec * 1000;
        this.#set(r, h.name, "", silent, `${r.label} from ${h.name}`);
      }
    }
  }
}

const key = (rule, host, subject) => JSON.stringify([rule, host, subject]);
const round = (v) => Math.round(v * 10) / 10;
