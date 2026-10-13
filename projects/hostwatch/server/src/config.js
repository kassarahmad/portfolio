import { readFileSync } from "node:fs";
import { parseAgentTokens } from "./auth.js";
import { DEFAULT_RULES, validateRules } from "./alerts.js";

const int = (v, d) => (v === undefined || v === "" ? d : Number.parseInt(v, 10));
const bool = (v, d) => (v === undefined || v === "" ? d : ["1", "true", "yes"].includes(String(v).toLowerCase()));

// NAME_FILE=/run/secrets/x reads NAME from a file (Docker/Compose secrets).
function withFileSecrets(env, names) {
  const out = { ...env };
  for (const name of names) if (env[`${name}_FILE`]) out[name] = readFileSync(env[`${name}_FILE`], "utf8").trim();
  return out;
}

export function loadConfig(rawEnv = process.env) {
  const env = withFileSecrets(rawEnv, [
    "HOSTWATCH_SESSION_SECRET",
    "HOSTWATCH_PASSWORD_HASH",
    "HOSTWATCH_AGENT_TOKENS",
  ]);
  const errors = [];
  const sessionSecret = env.HOSTWATCH_SESSION_SECRET;
  if (!sessionSecret || Buffer.byteLength(sessionSecret) < 32)
    errors.push("HOSTWATCH_SESSION_SECRET must be at least 32 bytes");
  const passwordHash = env.HOSTWATCH_PASSWORD_HASH;
  if (!passwordHash?.startsWith("scrypt$"))
    errors.push("HOSTWATCH_PASSWORD_HASH must be set (node src/cli.js hash-password)");

  let agentTokens = new Map();
  try {
    agentTokens = parseAgentTokens(env.HOSTWATCH_AGENT_TOKENS);
    if (!agentTokens.size) errors.push("HOSTWATCH_AGENT_TOKENS must list at least one host=token pair");
  } catch (e) {
    errors.push(e.message);
  }

  let rules = DEFAULT_RULES;
  try {
    if (env.HOSTWATCH_RULES_FILE) rules = validateRules(JSON.parse(readFileSync(env.HOSTWATCH_RULES_FILE, "utf8")));
  } catch (e) {
    errors.push(`HOSTWATCH_RULES_FILE: ${e.message}`);
  }

  const webhook = env.HOSTWATCH_ALERT_WEBHOOK || "";
  if (webhook) {
    const u = URL.canParse(webhook) ? new URL(webhook) : null;
    if (!u || (u.protocol !== "https:" && !["localhost", "127.0.0.1"].includes(u.hostname)))
      errors.push("HOSTWATCH_ALERT_WEBHOOK must be an https URL");
  }

  if (errors.length)
    throw Object.assign(new Error(`Invalid configuration:\n- ${errors.join("\n- ")}`), { code: "CONFIG" });
  return {
    port: int(env.PORT, 4000),
    host: env.HOST || "0.0.0.0",
    dbFile: env.HOSTWATCH_DB || "./data/hostwatch.db",
    retentionHours: int(env.HOSTWATCH_RETENTION_HOURS, 48),
    sessionSecret,
    sessionTtlMs: int(env.HOSTWATCH_SESSION_HOURS, 12) * 3_600_000,
    passwordHash,
    agentTokens,
    rules,
    webhook,
    cookieSecure: bool(env.COOKIE_SECURE, true),
    trustProxy: bool(env.TRUST_PROXY, false),
    maxStreamClients: int(env.HOSTWATCH_MAX_STREAMS, 50),
    logLevel: env.LOG_LEVEL || "info",
  };
}
