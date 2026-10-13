import crypto from "node:crypto";
import { parse, v } from "../lib/validate.js";
import { conflict, unauthorized } from "../lib/errors.js";
import { dummyVerify, hashPassword, randomToken, sha256, signJwt, verifyPassword } from "../lib/crypto.js";
import { toUser } from "./common.js";

export const COOKIE = "sb_refresh";
export const passwordRule = v.string({ min: 10, max: 200, trim: false });

const registerSchema = v.object({
  email: v.email(),
  password: passwordRule,
  name: v.string({ min: 1, max: 100 }),
  phone: v.optional(v.string({ max: 30, pattern: /^\+?[0-9 ()-]{6,30}$/ })),
});
const loginSchema = v.object({ email: v.email(), password: v.string({ min: 1, max: 200, trim: false }) });

function readCookie(req, name) {
  const header = req.headers.cookie || "";
  for (const part of header.split(";")) {
    const [k, ...rest] = part.trim().split("=");
    if (k === name) return decodeURIComponent(rest.join("="));
  }
  return null;
}

export function registerAuth(router, { db, config }) {
  const cookie = (value, maxAge) =>
    [
      `${COOKIE}=${value}`,
      "Path=/api/v1/auth",
      "HttpOnly",
      "SameSite=Strict",
      `Max-Age=${maxAge}`,
      config.cookieSecure ? "Secure" : null,
    ]
      .filter(Boolean)
      .join("; ");

  async function issue(client, user, familyId = crypto.randomUUID()) {
    const refresh = randomToken();
    const ttl = config.refreshTokenTtlDays * 86400;
    await client.query(
      `insert into refresh_tokens (user_id, token_hash, family_id, expires_at)
       values ($1, $2, $3, now() + make_interval(secs => $4))`,
      [user.id, sha256(refresh), familyId, ttl],
    );
    return {
      __headers: { "Set-Cookie": cookie(refresh, ttl) },
      accessToken: signJwt({ sub: user.id, role: user.role }, config.jwtSecret, config.accessTokenTtlSec),
      tokenType: "Bearer",
      expiresIn: config.accessTokenTtlSec,
      user: toUser(user),
    };
  }

  router.post("/auth/register", { bucket: "auth" }, async (ctx) => {
    const input = parse(registerSchema, ctx.body);
    const hash = await hashPassword(input.password);
    return db.tx(async (c) => {
      const { rows } = await c.query(
        `insert into users (email, password_hash, name, phone) values ($1, $2, $3, $4)
         on conflict (email) do nothing returning *`,
        [input.email, hash, input.name, input.phone ?? null],
      );
      if (!rows[0]) throw conflict("An account with this email already exists. Sign in instead.", "email_taken");
      return issue(c, rows[0]);
    });
  });

  router.post("/auth/login", { bucket: "auth" }, async (ctx) => {
    const input = parse(loginSchema, ctx.body);
    const { rows } = await db.query("select * from users where email = $1", [input.email]);
    const user = rows[0];
    const ok = user ? await verifyPassword(input.password, user.password_hash) : await dummyVerify(input.password);
    if (!ok) throw unauthorized("Email or password is incorrect.");
    const out = await db.tx((c) => issue(c, user));
    return { ...out, __status: 200 };
  });

  // Rotation with reuse detection: each refresh token works once. Presenting a
  // token that was already rotated means it leaked, so the whole family dies.
  router.post("/auth/refresh", { bucket: "session" }, async (ctx) => {
    const token = readCookie(ctx.req, COOKIE);
    if (!token) throw unauthorized("Sign in to continue.");
    const out = await db.tx(async (c) => {
      const { rows } = await c.query(
        `select t.*, u.id as uid, u.email, u.name, u.phone, u.role, u.created_at as user_created_at
           from refresh_tokens t join users u on u.id = t.user_id
          where t.token_hash = $1 for update of t`,
        [sha256(token)],
      );
      const t = rows[0];
      if (!t) return null;
      if (t.revoked_at) {
        await c.query("update refresh_tokens set revoked_at = coalesce(revoked_at, now()) where family_id = $1", [
          t.family_id,
        ]);
        return "reused";
      }
      if (t.expires_at <= new Date()) return null;
      await c.query("update refresh_tokens set revoked_at = now() where id = $1", [t.id]);
      const user = {
        id: t.uid,
        email: t.email,
        name: t.name,
        phone: t.phone,
        role: t.role,
        created_at: t.user_created_at,
      };
      return issue(c, user, t.family_id);
    });
    if (!out || out === "reused") {
      ctx.res.setHeader("Set-Cookie", cookie("", 0));
      throw unauthorized("Your session has expired. Sign in again.");
    }
    return { ...out, __status: 200 };
  });

  router.post("/auth/logout", { bucket: "session" }, async (ctx) => {
    const token = readCookie(ctx.req, COOKIE);
    if (token) {
      await db.query(
        `update refresh_tokens set revoked_at = coalesce(revoked_at, now())
          where family_id = (select family_id from refresh_tokens where token_hash = $1)`,
        [sha256(token)],
      );
    }
    ctx.res.setHeader("Set-Cookie", cookie("", 0));
    return undefined;
  });
}
