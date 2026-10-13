#!/usr/bin/env node
// Operational commands. Usage:
//   node scripts/cli.js migrate
//   SLOTBOOK_OWNER_PASSWORD=... node scripts/cli.js create-owner owner@example.com "Owner Name"
//   node scripts/cli.js seed-demo        (fictional demo data, refuses to run in production)
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Pool } from "../src/lib/pg/pool.js";
import { migrate } from "../src/db/migrate.js";
import { hashPassword } from "../src/lib/crypto.js";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const dbOpts = {
  host: process.env.PGHOST || "127.0.0.1",
  port: Number(process.env.PGPORT || 5432),
  user: process.env.PGUSER,
  password: process.env.PGPASSWORD || "",
  database: process.env.PGDATABASE,
};
const [cmd, ...args] = process.argv.slice(2);
const out = (s) => process.stdout.write(s + "\n");

if (!dbOpts.user || !dbOpts.database) {
  out("Set PGUSER and PGDATABASE (and PGHOST/PGPORT/PGPASSWORD as needed).");
  process.exit(2);
}

if (cmd === "migrate") {
  const done = await migrate(dbOpts, path.join(root, "migrations"));
  out(done.length ? `Applied: ${done.join(", ")}` : "Already up to date.");
} else if (cmd === "create-owner") {
  const [email, name = "Owner"] = args;
  const password = process.env.SLOTBOOK_OWNER_PASSWORD;
  if (!email || !password || password.length < 12) {
    out("Usage: SLOTBOOK_OWNER_PASSWORD=<12+ chars> node scripts/cli.js create-owner <email> [name]");
    process.exit(2);
  }
  const db = new Pool(dbOpts, { max: 1 });
  const { rows } = await db.query(
    `insert into users (email, password_hash, name, role) values ($1, $2, $3, 'owner')
     on conflict (email) do update set role = 'owner', updated_at = now() returning id`,
    [email.toLowerCase(), await hashPassword(password), name],
  );
  out(`Owner ready: ${email} (${rows[0].id}). If the account existed, its password was not changed.`);
  await db.end();
} else if (cmd === "seed-demo") {
  if (process.env.NODE_ENV === "production") {
    out("Refusing to seed demo data with NODE_ENV=production.");
    process.exit(2);
  }
  const { seedDemo } = await import("./seed-demo.js");
  const db = new Pool(dbOpts, { max: 1 });
  const summary = await seedDemo(db);
  out(summary);
  await db.end();
} else {
  out("Commands: migrate | create-owner <email> [name] | seed-demo");
  process.exit(2);
}
