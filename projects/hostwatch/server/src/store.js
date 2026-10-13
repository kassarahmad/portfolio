import { DatabaseSync } from "node:sqlite";

/**
 * Time-series storage on SQLite (node:sqlite, built into Node 22).
 * One row per sample with the numeric series the charts and alert rules use;
 * the full latest sample per host is kept as JSON for the detail view.
 * Old samples are deleted by `prune()` according to the retention window.
 */
export class Store {
  constructor(file = ":memory:") {
    this.db = new DatabaseSync(file);
    this.db.exec(`
      pragma journal_mode = wal;
      pragma synchronous = normal;
      create table if not exists hosts (
        name text primary key,
        simulated integer not null default 0,
        first_seen integer not null,
        last_seen integer not null,
        latest text not null
      );
      create table if not exists samples (
        host text not null,
        ts integer not null,
        cpu real, mem real, swap real, load1 real, disk real, rx real, tx real
      );
      create index if not exists samples_host_ts on samples (host, ts);
      create table if not exists alerts (
        id integer primary key autoincrement,
        rule text not null,
        host text not null,
        subject text not null default '',
        severity text not null,
        message text not null,
        started_at integer not null,
        resolved_at integer
      );
      create index if not exists alerts_open on alerts (resolved_at, started_at);
    `);
    this.q = {
      upsertHost: this.db.prepare(`
        insert into hosts (name, simulated, first_seen, last_seen, latest) values (?, ?, ?, ?, ?)
        on conflict (name) do update set simulated = excluded.simulated, last_seen = excluded.last_seen, latest = excluded.latest`),
      insertSample: this.db.prepare(
        "insert into samples (host, ts, cpu, mem, swap, load1, disk, rx, tx) values (?, ?, ?, ?, ?, ?, ?, ?, ?)",
      ),
      hosts: this.db.prepare("select name, simulated, first_seen, last_seen, latest from hosts order by name"),
      host: this.db.prepare("select name, simulated, first_seen, last_seen, latest from hosts where name = ?"),
      openAlert: this.db.prepare(
        "insert into alerts (rule, host, subject, severity, message, started_at) values (?, ?, ?, ?, ?, ?)",
      ),
      resolveAlert: this.db.prepare(
        "update alerts set resolved_at = ? where rule = ? and host = ? and subject = ? and resolved_at is null",
      ),
      openAlerts: this.db.prepare("select * from alerts where resolved_at is null order by started_at desc"),
      recentAlerts: this.db.prepare("select * from alerts order by started_at desc limit ?"),
      prune: this.db.prepare("delete from samples where ts < ?"),
      pruneAlerts: this.db.prepare("delete from alerts where resolved_at is not null and resolved_at < ?"),
    };
  }

  /** Persist one validated sample; returns the numeric row that was stored. */
  addSample(s, receivedAt = Date.now()) {
    const ts = Math.min(Date.parse(s.ts), receivedAt + 60_000); // ignore clocks far in the future
    const row = {
      cpu: s.cpu.usagePct,
      mem: s.mem.usedPct,
      swap: s.mem.swapUsedPct ?? null,
      load1: s.load[0],
      disk: s.disks.length ? Math.max(...s.disks.map((d) => d.usedPct)) : null,
      rx: s.net.rxBytesPerSec,
      tx: s.net.txBytesPerSec,
    };
    const existing = this.q.host.get(s.host);
    this.q.upsertHost.run(
      s.host,
      s.simulated ? 1 : 0,
      existing?.first_seen ?? receivedAt,
      receivedAt,
      JSON.stringify(s),
    );
    this.q.insertSample.run(s.host, ts, row.cpu, row.mem, row.swap, row.load1, row.disk, row.rx, row.tx);
    return { ts, ...row };
  }

  hosts() {
    return this.q.hosts.all().map(toHost);
  }

  host(name) {
    const r = this.q.host.get(name);
    return r ? toHost(r) : null;
  }

  /**
   * Averages per time bucket so a chart never receives more than ~`points` values
   * whatever the range. Gaps (no samples) are simply absent buckets.
   */
  series(host, fromMs, toMs, points = 240) {
    const step = Math.max(1000, Math.ceil((toMs - fromMs) / points / 1000) * 1000);
    const rows = this.db
      .prepare(
        `select (cast(ts as integer) / cast(? as integer)) * cast(? as integer) as t, avg(cpu) cpu, avg(mem) mem, avg(swap) swap, avg(load1) load1,
                max(disk) disk, avg(rx) rx, avg(tx) tx
           from samples where host = ? and ts >= ? and ts <= ?
          group by t order by t`,
      )
      .all(step, step, host, fromMs, toMs);
    return { step, points: rows.map((r) => ({ ...r, t: Number(r.t) })) };
  }

  openAlert({ rule, host, subject = "", severity, message, at = Date.now() }) {
    this.q.openAlert.run(rule, host, subject, severity, message, at);
  }

  resolveAlert({ rule, host, subject = "", at = Date.now() }) {
    this.q.resolveAlert.run(at, rule, host, subject);
  }

  openAlerts() {
    return this.q.openAlerts.all().map(toAlert);
  }

  recentAlerts(limit = 50) {
    return this.q.recentAlerts.all(limit).map(toAlert);
  }

  prune(retentionMs, now = Date.now()) {
    const a = this.q.prune.run(now - retentionMs);
    this.q.pruneAlerts.run(now - retentionMs * 7);
    return Number(a.changes);
  }

  close() {
    this.db.close();
  }
}

const toHost = (r) => ({
  name: r.name,
  simulated: Boolean(r.simulated),
  firstSeen: new Date(r.first_seen).toISOString(),
  lastSeen: new Date(r.last_seen).toISOString(),
  latest: JSON.parse(r.latest),
});

const toAlert = (r) => ({
  id: Number(r.id),
  rule: r.rule,
  host: r.host,
  subject: r.subject,
  severity: r.severity,
  message: r.message,
  startedAt: new Date(r.started_at).toISOString(),
  resolvedAt: r.resolved_at ? new Date(r.resolved_at).toISOString() : null,
});
