import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { Client } from "../lib/pg/client.js";

/**
 * Forward-only migrations. Each file runs in its own transaction; applied
 * files are recorded with a checksum, and editing an applied file is an error
 * rather than a silent drift. An advisory lock stops two instances migrating
 * at the same time (for example two containers starting together).
 */
export async function migrate(dbOpts, dir, log = (_event) => {}) {
  const client = new Client(dbOpts);
  await client.connect();
  try {
    await client.exec("select pg_advisory_lock(728301)");
    await client.exec(`create table if not exists schema_migrations (
      version text primary key, checksum text not null, applied_at timestamptz not null default now())`);
    const { rows } = await client.query("select version, checksum from schema_migrations");
    const applied = new Map(rows.map((r) => [r.version, r.checksum]));
    const files = (await readdir(dir)).filter((f) => /^\d{3}_[\w-]+\.sql$/.test(f)).sort();
    const done = [];
    for (const file of files) {
      const sql = await readFile(path.join(dir, file), "utf8");
      const sum = crypto.createHash("sha256").update(sql).digest("hex");
      if (applied.has(file)) {
        if (applied.get(file) !== sum) throw new Error(`Migration ${file} was changed after it was applied`);
        continue;
      }
      try {
        await client.exec(`begin;\n${sql}\n;`);
        await client.query("insert into schema_migrations (version, checksum) values ($1, $2)", [file, sum]);
        await client.exec("commit");
      } catch (err) {
        await client.exec("rollback").catch(() => {});
        throw new Error(`Migration ${file} failed: ${err.message}`);
      }
      log({ level: "info", msg: "migration applied", version: file });
      done.push(file);
    }
    return done;
  } finally {
    await client.exec("select pg_advisory_unlock(728301)").catch(() => {});
    await client.end();
  }
}
