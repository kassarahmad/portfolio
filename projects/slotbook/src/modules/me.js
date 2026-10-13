import { parse, v } from "../lib/validate.js";
import { badRequest, conflict, unauthorized } from "../lib/errors.js";
import { hashPassword, verifyPassword } from "../lib/crypto.js";
import { passwordRule, COOKIE } from "./auth.js";
import { toUser } from "./common.js";

const updateSchema = v.object({
  name: v.optional(v.string({ min: 1, max: 100 })),
  phone: v.optional(v.nullable(v.string({ max: 30, pattern: /^\+?[0-9 ()-]{6,30}$/ }))),
});
const passwordSchema = v.object({
  currentPassword: v.string({ min: 1, max: 200, trim: false }),
  newPassword: passwordRule,
});
const deleteSchema = v.object({ password: v.string({ min: 1, max: 200, trim: false }) });

export function registerMe(router, { db }) {
  const AUTH = { auth: true };

  router.get("/me", AUTH, async ({ user }) => {
    const { rows } = await db.query("select * from users where id = $1", [user.id]);
    return toUser(rows[0]);
  });

  router.patch("/me", AUTH, async ({ user, body }) => {
    const input = parse(updateSchema, body);
    if (!Object.keys(input).length) throw badRequest("Send at least one field to change.");
    const { rows } = await db.query(
      `update users set name = coalesce($2, name),
              phone = case when $3::boolean then $4 else phone end,
              updated_at = now()
        where id = $1 returning *`,
      [user.id, input.name ?? null, "phone" in input, input.phone ?? null],
    );
    return toUser(rows[0]);
  });

  router.post("/me/password", { auth: true, bucket: "auth" }, async ({ user, body }) => {
    const input = parse(passwordSchema, body);
    const { rows } = await db.query("select password_hash from users where id = $1", [user.id]);
    if (!(await verifyPassword(input.currentPassword, rows[0].password_hash)))
      throw unauthorized("Your current password is incorrect.");
    const hash = await hashPassword(input.newPassword);
    await db.tx(async (c) => {
      await c.query("update users set password_hash = $2, updated_at = now() where id = $1", [user.id, hash]);
      // Sign out every other session.
      await c.query("update refresh_tokens set revoked_at = now() where user_id = $1 and revoked_at is null", [
        user.id,
      ]);
    });
    return undefined;
  });

  router.delete("/me", { auth: true, bucket: "auth" }, async ({ user, body, res }) => {
    const input = parse(deleteSchema, body ?? {});
    const { rows } = await db.query("select password_hash, role from users where id = $1", [user.id]);
    if (!(await verifyPassword(input.password, rows[0].password_hash)))
      throw unauthorized("Your password is incorrect.");
    if (rows[0].role !== "customer")
      throw conflict(
        "Staff and owner accounts can't be deleted from here. Ask the owner to change your role first.",
        "role_protected",
      );
    await db.query("delete from users where id = $1", [user.id]);
    res.setHeader("Set-Cookie", `${COOKIE}=; Path=/api/v1/auth; HttpOnly; SameSite=Strict; Max-Age=0`);
    return undefined;
  });
}
