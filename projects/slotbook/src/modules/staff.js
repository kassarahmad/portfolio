import { parse, v } from "../lib/validate.js";
import { ApiError, badRequest, conflict, notFound } from "../lib/errors.js";
import { id } from "./common.js";

const createSchema = v.object({
  email: v.email(),
  displayName: v.string({ min: 1, max: 80 }),
  bio: v.optional(v.string({ max: 300 })),
  serviceIds: v.optional(v.array(v.uuid(), { max: 50 })),
});
const updateSchema = v.object({
  displayName: v.optional(v.string({ min: 1, max: 80 })),
  bio: v.optional(v.string({ max: 300 })),
  active: v.optional(v.boolean()),
  serviceIds: v.optional(v.array(v.uuid(), { max: 50 })),
});
const hoursSchema = v.object({
  hours: v.array(v.object({ weekday: v.int({ min: 1, max: 7 }), start: v.time(), end: v.time() }), { max: 28 }),
});

/** Rejects empty or overlapping intervals on the same weekday. Exported for unit tests. */
export function checkHours(hours) {
  const byDay = new Map();
  for (const h of hours) {
    if (h.end <= h.start) throw badRequest(`On day ${h.weekday}, the end time must be after the start time.`);
    const list = byDay.get(h.weekday) ?? [];
    list.push(h);
    byDay.set(h.weekday, list);
  }
  for (const [day, list] of byDay) {
    list.sort((a, b) => a.start.localeCompare(b.start));
    for (let i = 1; i < list.length; i++) {
      if (list[i].start < list[i - 1].end) throw badRequest(`Working hours overlap on day ${day}.`);
    }
  }
}

const SELECT = `
  select sp.user_id as id, sp.display_name, sp.bio, sp.active,
         coalesce(array_to_json(array_agg(ss.service_id) filter (where ss.service_id is not null)), '[]') as service_ids
    from staff_profiles sp left join staff_services ss on ss.staff_id = sp.user_id`;

const toStaff = (r) => ({
  id: r.id,
  displayName: r.display_name,
  bio: r.bio,
  active: r.active,
  serviceIds: r.service_ids,
});

async function setServices(c, staffId, serviceIds) {
  await c.query("delete from staff_services where staff_id = $1", [staffId]);
  if (serviceIds.length) {
    await c.query(
      `insert into staff_services (staff_id, service_id) select $1, unnest($2::uuid[]) on conflict do nothing`,
      [staffId, `{${serviceIds.join(",")}}`],
    );
  }
}

export function registerStaff(router, { db }) {
  const OWNER = { auth: ["owner"] };

  router.get("/staff", async ({ user }) => {
    const all = user?.role === "owner";
    const { rows } = await db.query(
      `${SELECT} ${all ? "" : "where sp.active"} group by sp.user_id order by sp.display_name`,
    );
    return { data: rows.map(toStaff) };
  });

  router.get("/staff/:id/hours", async (ctx) => {
    const { rows } = await db.query(
      `select weekday, to_char(start_time, 'HH24:MI') as start, to_char(end_time, 'HH24:MI') as "end"
         from working_hours where staff_id = $1 order by weekday, start_time`,
      [id(ctx)],
    );
    return { data: rows };
  });

  // Promote an existing account (the person signs up first) to staff.
  router.post("/staff", OWNER, async ({ body }) => {
    const input = parse(createSchema, body);
    return db.tx(async (c) => {
      const { rows } = await c.query("select id, role from users where email = $1 for update", [input.email]);
      const u = rows[0];
      if (!u) throw new ApiError(404, "account_not_found", "No account uses that email. Ask them to sign up first.");
      if (u.role === "owner") throw conflict("The owner already has full access.", "already_owner");
      await c.query("update users set role = 'staff', updated_at = now() where id = $1", [u.id]);
      await c.query(
        `insert into staff_profiles (user_id, display_name, bio) values ($1, $2, $3)
         on conflict (user_id) do update set display_name = excluded.display_name, bio = excluded.bio, active = true`,
        [u.id, input.displayName, input.bio ?? ""],
      );
      if (input.serviceIds) await setServices(c, u.id, input.serviceIds);
      const out = await c.query(`${SELECT} where sp.user_id = $1 group by sp.user_id`, [u.id]);
      return toStaff(out.rows[0]);
    });
  });

  router.patch("/staff/:id", OWNER, async (ctx) => {
    const input = parse(updateSchema, ctx.body);
    const staffId = id(ctx);
    return db.tx(async (c) => {
      const { rows } = await c.query(
        `update staff_profiles set display_name = coalesce($2, display_name), bio = coalesce($3, bio), active = coalesce($4, active)
          where user_id = $1 returning user_id`,
        [staffId, input.displayName ?? null, input.bio ?? null, input.active ?? null],
      );
      if (!rows[0]) throw notFound("Staff member");
      if (input.serviceIds) await setServices(c, staffId, input.serviceIds);
      const out = await c.query(`${SELECT} where sp.user_id = $1 group by sp.user_id`, [staffId]);
      return toStaff(out.rows[0]);
    });
  });

  router.put("/staff/:id/hours", OWNER, async (ctx) => {
    const { hours } = parse(hoursSchema, ctx.body);
    checkHours(hours);
    const staffId = id(ctx);
    await db.tx(async (c) => {
      const { rows } = await c.query("select 1 from staff_profiles where user_id = $1 for update", [staffId]);
      if (!rows[0]) throw notFound("Staff member");
      await c.query("delete from working_hours where staff_id = $1", [staffId]);
      for (const h of hours) {
        await c.query("insert into working_hours (staff_id, weekday, start_time, end_time) values ($1, $2, $3, $4)", [
          staffId,
          h.weekday,
          h.start,
          h.end,
        ]);
      }
    });
    return { data: [...hours].sort((a, b) => a.weekday - b.weekday || a.start.localeCompare(b.start)), __status: 200 };
  });
}
