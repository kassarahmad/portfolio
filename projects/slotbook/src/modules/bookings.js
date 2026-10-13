import { parse, v } from "../lib/validate.js";
import { ApiError, badRequest, conflict, forbidden, notFound } from "../lib/errors.js";
import { id, pageQuery, paged, paging } from "./common.js";

const STATUSES = ["confirmed", "cancelled", "completed", "no_show"];
const SORTS = { starts: "b.starts_at", created: "b.created_at" };

const availabilitySchema = v.object({
  serviceId: v.uuid(),
  date: v.date(),
  staffId: v.optional(v.uuid()),
});
const listSchema = v.object({
  ...pageQuery,
  status: v.optional(v.enum(STATUSES)),
  from: v.optional(v.date()),
  to: v.optional(v.date()),
  staffId: v.optional(v.uuid()),
  sort: v.optional(v.enum(Object.keys(SORTS))),
  order: v.optional(v.enum(["asc", "desc"])),
});
const createSchema = v.object({
  serviceId: v.uuid(),
  staffId: v.uuid(),
  startsAt: v.datetime(),
  notes: v.optional(v.string({ max: 500 })),
});
const cancelSchema = v.object({ reason: v.optional(v.string({ max: 200 })) });

const SELECT = `
  select b.*, s.name as service_name, sp.display_name as staff_name, u.name as customer_name, u.email as customer_email
    from bookings b
    join services s on s.id = b.service_id
    join staff_profiles sp on sp.user_id = b.staff_id
    join users u on u.id = b.customer_id`;

export function toBooking(r, viewer) {
  const out = {
    id: r.id,
    status: r.status,
    startsAt: r.starts_at,
    endsAt: r.ends_at,
    priceCents: r.price_cents,
    notes: r.notes,
    service: { id: r.service_id, name: r.service_name },
    staff: { id: r.staff_id, name: r.staff_name },
    cancelledAt: r.cancelled_at,
    cancelReason: r.cancel_reason,
    createdAt: r.created_at,
  };
  // Customers see their own details; staff and the owner see who booked.
  out.customer =
    viewer.role === "customer"
      ? { id: r.customer_id }
      : { id: r.customer_id, name: r.customer_name, email: r.customer_email };
  return out;
}

/** Row-level scope for the viewer, as a SQL condition plus params. */
function scope(user, params) {
  if (user.role === "owner") return "true";
  params.push(user.id);
  return user.role === "staff" ? `b.staff_id = $${params.length}` : `b.customer_id = $${params.length}`;
}

export function registerBookings(router, { db, config }) {
  const tz = config.businessTz;

  router.get("/availability", async ({ query }) => {
    const q = parse(availabilitySchema, query);
    const svc = await db.query("select id, duration_min from services where id = $1 and active", [q.serviceId]);
    if (!svc.rows[0]) throw notFound("Service");
    const { rows } = await db.query(
      `with hours as (
         select w.staff_id, sp.display_name,
                ($1::date + w.start_time) at time zone $2 as open_at,
                ($1::date + w.end_time)   at time zone $2 as close_at
           from working_hours w
           join staff_profiles sp on sp.user_id = w.staff_id and sp.active
           join staff_services ss on ss.staff_id = w.staff_id and ss.service_id = $3
          where w.weekday = extract(isodow from $1::date)
            and ($4::uuid is null or w.staff_id = $4)
       ), slots as (
         select h.staff_id, h.display_name, g as starts_at, g + make_interval(mins => $5) as ends_at
           from hours h,
                generate_series(h.open_at, h.close_at - make_interval(mins => $5), make_interval(mins => $6)) g
       )
       select staff_id, display_name, starts_at, ends_at
         from slots s
        where s.starts_at >= now() + make_interval(mins => $7)
          and s.starts_at <= now() + make_interval(days => $8)
          and not exists (
            select 1 from bookings b
             where b.staff_id = s.staff_id and b.status <> 'cancelled'
               and tstzrange(b.starts_at, b.ends_at, '[)') && tstzrange(s.starts_at, s.ends_at, '[)'))
        order by starts_at, display_name`,
      [
        q.date,
        tz,
        q.serviceId,
        q.staffId ?? null,
        svc.rows[0].duration_min,
        config.slotStepMin,
        config.minLeadMin,
        config.horizonDays,
      ],
    );
    return {
      date: q.date,
      timeZone: tz,
      durationMin: svc.rows[0].duration_min,
      slots: rows.map((r) => ({
        staffId: r.staff_id,
        staffName: r.display_name,
        startsAt: r.starts_at,
        endsAt: r.ends_at,
      })),
    };
  });

  router.get("/bookings", { auth: true }, async ({ query, user }) => {
    const q = parse(listSchema, query);
    const params = [];
    const where = [scope(user, params)];
    if (q.status) {
      params.push(q.status);
      where.push(`b.status = $${params.length}`);
    }
    if (q.from) {
      params.push(q.from, tz);
      where.push(`b.starts_at >= ($${params.length - 1}::date::timestamp at time zone $${params.length})`);
    }
    if (q.to) {
      params.push(q.to, tz);
      where.push(`b.starts_at < (($${params.length - 1}::date + 1)::timestamp at time zone $${params.length})`);
    }
    if (q.staffId) {
      if (user.role !== "owner") throw forbidden("Only the owner can filter by staff member.");
      params.push(q.staffId);
      where.push(`b.staff_id = $${params.length}`);
    }
    const w = `where ${where.join(" and ")}`;
    const sort = SORTS[q.sort ?? "starts"];
    const order = q.order === "asc" ? "asc" : "desc";
    const pg = paging(q);
    const [{ rows }, count] = await Promise.all([
      db.query(`${SELECT} ${w} order by ${sort} ${order}, b.id limit ${pg.limit} offset ${pg.offset}`, params),
      db.query(`select count(*)::int as n from bookings b ${w}`, params),
    ]);
    return paged(
      rows.map((r) => toBooking(r, user)),
      count.rows[0].n,
      pg,
    );
  });

  router.get("/bookings/:id", { auth: true }, async (ctx) => {
    const params = [id(ctx)];
    const { rows } = await db.query(`${SELECT} where b.id = $1 and ${scope(ctx.user, params)}`, params);
    if (!rows[0]) throw notFound("Booking"); // also hides other people's bookings
    return toBooking(rows[0], ctx.user);
  });

  router.post("/bookings", { auth: true }, async ({ body, user }) => {
    const input = parse(createSchema, body);
    const start = input.startsAt;
    if (start.getUTCSeconds() || start.getUTCMilliseconds() || start.getUTCMinutes() % 5)
      throw badRequest("Start times must be on a 5-minute boundary.");
    const minStart = Date.now() + config.minLeadMin * 60_000;
    if (start.getTime() < minStart) throw badRequest(`Book at least ${config.minLeadMin} minutes ahead.`);
    if (start.getTime() > Date.now() + config.horizonDays * 86_400_000)
      throw badRequest(`You can book up to ${config.horizonDays} days ahead.`);

    return db.tx(async (c) => {
      const svc = await c.query("select * from services where id = $1 and active", [input.serviceId]);
      if (!svc.rows[0]) throw notFound("Service");
      const s = svc.rows[0];
      const end = new Date(start.getTime() + s.duration_min * 60_000);

      const fits = await c.query(
        `select 1
           from staff_profiles sp
           join staff_services ss on ss.staff_id = sp.user_id and ss.service_id = $2
           join working_hours w on w.staff_id = sp.user_id
          where sp.user_id = $1 and sp.active
            and w.weekday = extract(isodow from ($3::timestamptz at time zone $5))
            and ($3::timestamptz at time zone $5)::date = ($4::timestamptz at time zone $5)::date
            and ($3::timestamptz at time zone $5)::time >= w.start_time
            and ($4::timestamptz at time zone $5)::time <= w.end_time
          limit 1`,
        [input.staffId, s.id, start, end, tz],
      );
      if (!fits.rows[0])
        throw conflict("That staff member isn't available for this service at that time.", "outside_hours");

      const own = await c.query(
        `select 1 from bookings where customer_id = $1 and status = 'confirmed'
            and tstzrange(starts_at, ends_at, '[)') && tstzrange($2, $3, '[)') limit 1`,
        [user.id, start, end],
      );
      if (own.rows[0]) throw conflict("You already have a booking that overlaps this time.", "customer_overlap");

      // The exclusion constraint is the real guard against double booking:
      // two concurrent requests for the same slot cannot both commit.
      const ins = await c.query(
        `insert into bookings (customer_id, staff_id, service_id, starts_at, ends_at, price_cents, notes)
         values ($1, $2, $3, $4, $5, $6, $7) returning id`,
        [user.id, input.staffId, s.id, start, end, s.price_cents, input.notes ?? ""],
      );
      const out = await c.query(`${SELECT} where b.id = $1`, [ins.rows[0].id]);
      return toBooking(out.rows[0], user);
    });
  });

  router.post("/bookings/:id/cancel", { auth: true }, async (ctx) => {
    const { reason } = parse(cancelSchema, ctx.body ?? {});
    const bookingId = id(ctx);
    const user = ctx.user;
    return db.tx(async (c) => {
      const params = [bookingId];
      const { rows } = await c.query(
        `select b.* from bookings b where b.id = $1 and ${scope(user, params)} for update`,
        params,
      );
      const b = rows[0];
      if (!b) throw notFound("Booking");
      if (b.status !== "confirmed")
        throw conflict(`This booking is already ${b.status.replace("_", " ")}.`, "invalid_state");
      if (user.role === "customer" && b.starts_at.getTime() - Date.now() < config.cancelCutoffMin * 60_000)
        throw new ApiError(
          409,
          "too_late",
          `Bookings can be cancelled online up to ${config.cancelCutoffMin} minutes before. Call the business instead.`,
        );
      await c.query(
        `update bookings set status = 'cancelled', cancelled_at = now(), cancel_reason = $2, updated_at = now() where id = $1`,
        [bookingId, reason ?? null],
      );
      const out = await c.query(`${SELECT} where b.id = $1`, [bookingId]);
      return { ...toBooking(out.rows[0], user), __status: 200 };
    });
  });

  for (const [action, status] of [
    ["complete", "completed"],
    ["no-show", "no_show"],
  ]) {
    router.post(`/bookings/:id/${action}`, { auth: ["staff", "owner"] }, async (ctx) => {
      const bookingId = id(ctx);
      return db.tx(async (c) => {
        const params = [bookingId];
        const { rows } = await c.query(
          `select b.* from bookings b where b.id = $1 and ${scope(ctx.user, params)} for update`,
          params,
        );
        const b = rows[0];
        if (!b) throw notFound("Booking");
        if (b.status !== "confirmed")
          throw conflict(`This booking is already ${b.status.replace("_", " ")}.`, "invalid_state");
        if (b.starts_at > new Date()) throw conflict("This appointment hasn't started yet.", "not_started");
        await c.query("update bookings set status = $2, updated_at = now() where id = $1", [bookingId, status]);
        const out = await c.query(`${SELECT} where b.id = $1`, [bookingId]);
        return { ...toBooking(out.rows[0], ctx.user), __status: 200 };
      });
    });
  }
}
