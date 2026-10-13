import crypto from "node:crypto";

// ---- Dashboard password (scrypt hash kept in the environment) ----
export function hashPassword(password, salt = crypto.randomBytes(16)) {
  const key = crypto.scryptSync(password.normalize("NFKC"), salt, 64, {
    N: 32768,
    r: 8,
    p: 1,
    maxmem: 64 * 1024 * 1024,
  });
  return `scrypt$${salt.toString("base64")}$${key.toString("base64")}`;
}

export function verifyPassword(password, stored) {
  const [kind, salt, hash] = String(stored).split("$");
  if (kind !== "scrypt" || !salt || !hash) return false;
  const expected = Buffer.from(hash, "base64");
  const key = crypto.scryptSync(password.normalize("NFKC"), Buffer.from(salt, "base64"), expected.length, {
    N: 32768,
    r: 8,
    p: 1,
    maxmem: 64 * 1024 * 1024,
  });
  return crypto.timingSafeEqual(key, expected);
}

// ---- Sessions: stateless signed cookie "<expiresMs>.<nonce>.<hmac>" ----
export function createSession(secret, ttlMs, now = Date.now()) {
  const body = `${now + ttlMs}.${crypto.randomBytes(12).toString("base64url")}`;
  return `${body}.${crypto.createHmac("sha256", secret).update(body).digest("base64url")}`;
}

export function verifySession(value, secret, now = Date.now()) {
  if (typeof value !== "string") return false;
  const i = value.lastIndexOf(".");
  if (i < 0) return false;
  const body = value.slice(0, i);
  const sig = Buffer.from(value.slice(i + 1), "base64url");
  const expected = crypto.createHmac("sha256", secret).update(body).digest();
  if (sig.length !== expected.length || !crypto.timingSafeEqual(sig, expected)) return false;
  return Number(body.split(".")[0]) > now;
}

export function readCookie(header, name) {
  for (const part of String(header || "").split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return decodeURIComponent(v.join("="));
  }
  return null;
}

// ---- Agent tokens: HOSTWATCH_AGENT_TOKENS="web-1=<token>,db-1=<token>" ----
// Each token may only report for its own host name. Tokens are compared by hash
// in constant time; the plain values never leave this module.
export function parseAgentTokens(spec) {
  const map = new Map();
  for (const pair of String(spec || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)) {
    const [host, token] = pair.split("=");
    if (!host || !token || token.length < 24)
      throw new Error(`HOSTWATCH_AGENT_TOKENS: token for "${host}" must be at least 24 characters`);
    map.set(crypto.createHash("sha256").update(token).digest("hex"), host);
  }
  return map;
}

export function hostForToken(tokens, token) {
  if (!token) return null;
  const h = crypto.createHash("sha256").update(token).digest("hex");
  for (const [hash, host] of tokens) {
    if (crypto.timingSafeEqual(Buffer.from(hash), Buffer.from(h))) return host;
  }
  return null;
}
