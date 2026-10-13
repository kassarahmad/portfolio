// Configuration comes only from the environment. Missing or weak secrets stop
// the process at startup instead of falling back to a default.

const bool = (v, d) => (v === undefined || v === "" ? d : ["1", "true", "yes"].includes(String(v).toLowerCase()));
const int = (v, d, name) => {
  if (v === undefined || v === "") return d;
  const n = Number(v);
  if (!Number.isInteger(n)) throw new Error(`${name} must be an integer`);
  return n;
};

import { readFileSync } from "node:fs";

/**
 * Secrets may come from files (Docker/Compose secrets): for any NAME, setting
 * NAME_FILE=/run/secrets/x reads the value from that file instead.
 */
export function withFileSecrets(env, names) {
  const out = { ...env };
  for (const name of names) {
    const file = env[`${name}_FILE`];
    if (file) out[name] = readFileSync(file, "utf8").trim();
  }
  return out;
}

export function loadConfig(rawEnv = process.env) {
  const env = withFileSecrets(rawEnv, ["JWT_SECRET", "PGPASSWORD"]);
  const errors = [];
  const required = (name) => {
    const v = env[name];
    if (!v) errors.push(`${name} is required`);
    return v;
  };

  const jwtSecret = required("JWT_SECRET");
  if (jwtSecret && Buffer.byteLength(jwtSecret) < 32) errors.push("JWT_SECRET must be at least 32 bytes");

  const config = {
    env: env.NODE_ENV || "development",
    port: int(env.PORT, 3000, "PORT"),
    host: env.HOST || "0.0.0.0",
    db: {
      host: env.PGHOST || "127.0.0.1",
      port: int(env.PGPORT, 5432, "PGPORT"),
      user: required("PGUSER"),
      password: env.PGPASSWORD || "",
      database: required("PGDATABASE"),
      ssl: bool(env.PGSSL, false),
      poolMax: int(env.PG_POOL_MAX, 10, "PG_POOL_MAX"),
    },
    jwtSecret,
    accessTokenTtlSec: int(env.ACCESS_TOKEN_TTL_SEC, 900, "ACCESS_TOKEN_TTL_SEC"),
    refreshTokenTtlDays: int(env.REFRESH_TOKEN_TTL_DAYS, 30, "REFRESH_TOKEN_TTL_DAYS"),
    cookieSecure: bool(env.COOKIE_SECURE, true),
    trustProxy: bool(env.TRUST_PROXY, false),
    corsOrigins: (env.CORS_ORIGINS || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
    businessTz: env.BUSINESS_TZ || "Europe/Rome",
    slotStepMin: int(env.SLOT_STEP_MIN, 15, "SLOT_STEP_MIN"),
    minLeadMin: int(env.MIN_LEAD_MIN, 60, "MIN_LEAD_MIN"),
    horizonDays: int(env.BOOKING_HORIZON_DAYS, 60, "BOOKING_HORIZON_DAYS"),
    cancelCutoffMin: int(env.CANCEL_CUTOFF_MIN, 120, "CANCEL_CUTOFF_MIN"),
    rateLimit: {
      authPerMin: int(env.RATE_LIMIT_AUTH_PER_MIN, 10, "RATE_LIMIT_AUTH_PER_MIN"),
      sessionPerMin: int(env.RATE_LIMIT_SESSION_PER_MIN, 60, "RATE_LIMIT_SESSION_PER_MIN"),
      apiPerMin: int(env.RATE_LIMIT_API_PER_MIN, 300, "RATE_LIMIT_API_PER_MIN"),
    },
    logLevel: env.LOG_LEVEL || "info",
  };

  try {
    Intl.DateTimeFormat("en", { timeZone: config.businessTz });
  } catch {
    errors.push(`BUSINESS_TZ "${config.businessTz}" is not a valid IANA time zone`);
  }
  if (errors.length) {
    throw Object.assign(new Error(`Invalid configuration:\n- ${errors.join("\n- ")}`), { code: "CONFIG" });
  }
  return config;
}
