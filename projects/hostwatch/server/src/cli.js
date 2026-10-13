#!/usr/bin/env node
// Setup helpers. Usage:
//   HOSTWATCH_PASSWORD='a long passphrase' node src/cli.js hash-password
//   node src/cli.js new-token
import crypto from "node:crypto";
import { hashPassword } from "./auth.js";

const [cmd] = process.argv.slice(2);
const out = (s) => process.stdout.write(`${s}\n`);

if (cmd === "hash-password") {
  const pw = process.env.HOSTWATCH_PASSWORD;
  if (!pw || pw.length < 12) {
    out("Set HOSTWATCH_PASSWORD to a passphrase of at least 12 characters.");
    process.exit(2);
  }
  out(hashPassword(pw));
} else if (cmd === "new-token") {
  out(crypto.randomBytes(32).toString("base64url"));
} else if (cmd === "new-secret") {
  out(crypto.randomBytes(48).toString("base64url"));
} else {
  out("Commands: hash-password | new-token | new-secret");
  process.exit(2);
}
