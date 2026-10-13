import { parse, v } from "../lib/validate.js";
import { badRequest, notFound } from "../lib/errors.js";
import { id, likePattern, pageQuery, paged, paging } from "./common.js";

const SORTS = { name: "name", price: "price_cents", duration: "duration_min", created: "created_at" };

const listSchema = v.object({
  ...pageQuery,
  q: v.optional(v.string({ max: 80 })),
  sort: v.optional(v.enum(Object.keys(SORTS))),
  order: v.optional(v.enum(["asc", "desc"])),
  status: v.optional(v.enum(["active", "archived", "all"])),
});
const fields = {
  name: v.string({ min: 1, max: 80 }),
  description: v.optional(v.string({ max: 500 })),
  durationMin: v.int({ min: 5, max: 480 }),
  priceCents: v.int({ min: 0, max: 1_000_000 }),
};
const createSchema = v.object(fields);
const updateSchema = v.object({
  name: v.optional(fields.name),
  description: fields.description,
  durationMin: v.optional(fields.durationMin),
  priceCents: v.optional(fields.priceCents),
  active: v.optional(v.boolean()),
});

export const toService = (r) => ({
  id: r.id,
  name: r.name,
  description: r.description,
  durationMin: r.duration_min,
  priceCents: r.price_cents,
  active: r.active,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

export function registerServices(router, { db }) {
  const OWNER = { auth: ["owner"] };

  router.get("/services", async ({ query, user }) => {
    const q = parse(listSchema, query);
    // Only the owner can see archived services.
    const status = user?.role === "owner" ? (q.status ?? "active") : "active";
    const where = [];
    const params = [];
    if (status !== "all") {
      params.push(status === "active");
      where.push(`active = $${params.length}`);
    }
    if (q.q) {
      params.push(likePattern(q.q));
      where.push(`(name ilike $${params.length} or description ilike $${params.length})`);
    }
    const w = where.length ? `where ${where.join(" and ")}` : "";
    const sort = SORTS[q.sort ?? "name"];
    const order = q.order === "desc" ? "desc" : "asc";
    const pg = paging(q);
    const [{ rows }, count] = await Promise.all([
      db.query(
        `select * from services ${w} order by ${sort} ${order}, id limit ${pg.limit} offset ${pg.offset}`,
        params,
      ),
      db.query(`select count(*)::int as n from services ${w}`, params),
    ]);
    return paged(rows.map(toService), count.rows[0].n, pg);
  });

  router.get("/services/:id", async (ctx) => {
    const { rows } = await db.query("select * from services where id = $1", [id(ctx)]);
    if (!rows[0] || (!rows[0].active && ctx.user?.role !== "owner")) throw notFound("Service");
    return toService(rows[0]);
  });

  router.post("/services", OWNER, async ({ body }) => {
    const s = parse(createSchema, body);
    if (s.durationMin % 5) throw badRequest("Duration must be a multiple of 5 minutes.");
    const { rows } = await db.query(
      `insert into services (name, description, duration_min, price_cents) values ($1, $2, $3, $4) returning *`,
      [s.name, s.description ?? "", s.durationMin, s.priceCents],
    );
    return toService(rows[0]);
  });

  router.patch("/services/:id", OWNER, async (ctx) => {
    const s = parse(updateSchema, ctx.body);
    if (!Object.keys(s).length) throw badRequest("Send at least one field to change.");
    if (s.durationMin !== undefined && s.durationMin % 5) throw badRequest("Duration must be a multiple of 5 minutes.");
    // Existing bookings keep their own price and end time, so edits never rewrite history.
    const { rows } = await db.query(
      `update services set
         name = coalesce($2, name), description = coalesce($3, description),
         duration_min = coalesce($4, duration_min), price_cents = coalesce($5, price_cents),
         active = coalesce($6, active), updated_at = now()
       where id = $1 returning *`,
      [id(ctx), s.name ?? null, s.description ?? null, s.durationMin ?? null, s.priceCents ?? null, s.active ?? null],
    );
    if (!rows[0]) throw notFound("Service");
    return toService(rows[0]);
  });

  // Archive instead of delete: past bookings must still point at the service.
  router.delete("/services/:id", OWNER, async (ctx) => {
    const { rowCount } = await db.query("update services set active = false, updated_at = now() where id = $1", [
      id(ctx),
    ]);
    if (!rowCount) throw notFound("Service");
    return undefined;
  });
}
