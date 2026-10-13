import crypto from "node:crypto";
/** @returns {Promise<Buffer>} */
const scrypt = (password, salt, keylen, opts) =>
  new Promise((resolve, reject) =>
    crypto.scrypt(password, salt, keylen, opts, (err, key) => (err ? reject(err) : resolve(key))),
  );

// ---------- Passwords: scrypt (N=2^15, r=8, p=1), 16-byte salt ----------
const N = 32768,
  R = 8,
  P = 1,
  KEYLEN = 64,
  MAXMEM = 64 * 1024 * 1024;

export async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const key = await scrypt(password.normalize("NFKC"), salt, KEYLEN, { N, r: R, p: P, maxmem: MAXMEM });
  return `scrypt$${N}$${R}$${P}$${salt.toString("base64")}$${key.toString("base64")}`;
}

export async function verifyPassword(password, stored) {
  const parts = String(stored).split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;
  const [, n, r, p, salt, hash] = parts;
  const expected = Buffer.from(hash, "base64");
  const key = await scrypt(password.normalize("NFKC"), Buffer.from(salt, "base64"), expected.length, {
    N: Number(n),
    r: Number(r),
    p: Number(p),
    maxmem: MAXMEM,
  });
  return crypto.timingSafeEqual(key, expected);
}

// A real hash of a random password: used when an email is unknown so a
// failed login takes the same time whether or not the account exists.
let dummy;
export async function dummyVerify(password) {
  dummy ??= await hashPassword(crypto.randomBytes(16).toString("hex"));
  await verifyPassword(password, dummy);
  return false;
}

// ---------- JWT (HS256) ----------
const b64url = (buf) => Buffer.from(buf).toString("base64url");

export function signJwt(payload, secret, ttlSec) {
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const body = b64url(JSON.stringify({ ...payload, iat: now, exp: now + ttlSec, iss: "slotbook" }));
  const sig = crypto.createHmac("sha256", secret).update(`${header}.${body}`).digest("base64url");
  return `${header}.${body}.${sig}`;
}

/** Returns the payload, or null for anything malformed, forged or expired. */
export function verifyJwt(token, secret) {
  if (typeof token !== "string") return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [header, body, sig] = parts;
  let h, payload;
  try {
    h = JSON.parse(Buffer.from(header, "base64url").toString());
    payload = JSON.parse(Buffer.from(body, "base64url").toString());
  } catch {
    return null;
  }
  if (h.alg !== "HS256") return null; // never accept "none" or another algorithm
  const expected = crypto.createHmac("sha256", secret).update(`${header}.${body}`).digest();
  const given = Buffer.from(sig, "base64url");
  if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) return null;
  if (payload.iss !== "slotbook" || typeof payload.exp !== "number") return null;
  if (payload.exp <= Math.floor(Date.now() / 1000)) return null;
  return payload;
}

// ---------- Opaque tokens ----------
export const randomToken = () => crypto.randomBytes(32).toString("base64url");
export const sha256 = (s) => crypto.createHash("sha256").update(s).digest("hex");
