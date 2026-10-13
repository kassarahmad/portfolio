import { parse, v } from "../lib/validate.js";

export const pageQuery = {
  page: v.optional(v.int({ min: 1, max: 10_000, coerce: true })),
  limit: v.optional(v.int({ min: 1, max: 100, coerce: true })),
};

export function paging(q) {
  const page = q.page ?? 1;
  const limit = q.limit ?? 20;
  return { page, limit, offset: (page - 1) * limit };
}

export const paged = (rows, total, { page, limit }) => ({
  data: rows,
  page,
  limit,
  total,
  totalPages: Math.max(1, Math.ceil(total / limit)),
});

// Escape LIKE wildcards so user search text is matched literally.
export const likePattern = (s) => `%${s.replace(/[\\%_]/g, (c) => "\\" + c)}%`;

export const id = (ctx) => parse(v.uuid(), ctx.params.id);

export const toUser = (r) => ({
  id: r.id,
  email: r.email,
  name: r.name,
  phone: r.phone ?? null,
  role: r.role,
  createdAt: r.created_at,
});
