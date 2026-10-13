import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { futureDay, startTestApp } from "./helpers.js";

let app, owner, alice, bob, staffUser, service, day;
const API = "/api/v1";

before(async () => {
  app = await startTestApp({ RATE_LIMIT_AUTH_PER_MIN: "1000" });
  owner = await app.user("owner@example.com", "owner", "Owner");
  alice = await app.user("alice@example.com");
  bob = await app.user("bob@example.com");
  staffUser = await app.user("sara@example.com");

  service = (
    await app.call("POST", `${API}/services`, {
      token: owner.token,
      body: { name: "Haircut", durationMin: 30, priceCents: 2000 },
    })
  ).body;
  await app.call("POST", `${API}/staff`, {
    token: owner.token,
    body: { email: "sara@example.com", displayName: "Sara", serviceIds: [service.id] },
  });
  // Sara works every day 09:00-17:00 (UTC in tests).
  const hours = [1, 2, 3, 4, 5, 6, 7].map((weekday) => ({ weekday, start: "09:00", end: "17:00" }));
  const h = await app.call("PUT", `${API}/staff/${staffUser.id}/hours`, { token: owner.token, body: { hours } });
  assert.equal(h.status, 200);
  // Re-login: Sara's role changed to staff after her first token was issued.
  staffUser.token = (
    await app.call("POST", `${API}/auth/login`, {
      body: { email: "sara@example.com", password: "correct-horse-battery" },
    })
  ).body.accessToken;
  day = futureDay(3);
});
after(() => app?.close());

const at = (hhmm) => `${day.date}T${hhmm}:00Z`;
const book = (who, hhmm, extra = {}) =>
  app.call("POST", `${API}/bookings`, {
    token: who.token,
    body: { serviceId: service.id, staffId: staffUser.id, startsAt: at(hhmm), ...extra },
  });

describe("platform", () => {
  test("health checks the database", async () => {
    const r = await app.call("GET", `${API}/health`);
    assert.equal(r.status, 200);
    assert.equal(r.body.status, "ok");
  });

  test("security headers and request ids are on every response", async () => {
    const r = await app.call("GET", `${API}/services`);
    assert.equal(r.headers.get("x-content-type-options"), "nosniff");
    assert.match(r.headers.get("content-security-policy"), /frame-ancestors 'none'/);
    assert.match(r.headers.get("x-request-id"), /^[\w-]{8,}$/);
  });

  test("bad input is rejected with clear errors", async () => {
    const bad = await app.call("POST", `${API}/auth/login`, { body: "{nope" });
    assert.equal(bad.status, 400);
    const type = await app.call("POST", `${API}/auth/login`, {
      body: "x=1",
      headers: { "content-type": "text/plain" },
    });
    assert.equal(type.status, 415);
    const big = await app.call("POST", `${API}/auth/login`, {
      body: { email: "a@b.co", password: "x".repeat(40_000) },
    });
    assert.equal(big.status, 413);
    const v = await app.call("POST", `${API}/auth/register`, {
      body: { email: "nope", password: "short", name: "", role: "owner" },
    });
    assert.equal(v.status, 422);
    assert.deepEqual(v.body.error.details.map((d) => d.field).sort(), ["email", "name", "password", "role"]);
  });

  test("unknown endpoints and wrong methods", async () => {
    assert.equal((await app.call("GET", `${API}/nope`)).status, 404);
    const r = await app.call("PUT", `${API}/services`);
    assert.equal(r.status, 405);
    assert.match(r.headers.get("allow"), /GET/);
  });
});

describe("auth", () => {
  test("register, duplicate email, login with wrong password", async () => {
    const dup = await app.call("POST", `${API}/auth/register`, {
      body: { email: "ALICE@example.com", password: "another-long-pass", name: "A" },
    });
    assert.equal(dup.status, 409);
    assert.equal(dup.body.error.code, "email_taken");
    const wrong = await app.call("POST", `${API}/auth/login`, {
      body: { email: "alice@example.com", password: "not-the-password" },
    });
    assert.equal(wrong.status, 401);
    const ghost = await app.call("POST", `${API}/auth/login`, {
      body: { email: "ghost@example.com", password: "not-the-password" },
    });
    assert.equal(ghost.status, 401);
    assert.equal(ghost.body.error.message, wrong.body.error.message, "no account enumeration via messages");
  });

  test("refresh cookie is HttpOnly and scoped; rotation and reuse detection", async () => {
    const login = await app.call("POST", `${API}/auth/login`, {
      body: { email: "bob@example.com", password: "correct-horse-battery" },
    });
    const setCookie = login.headers.get("set-cookie");
    assert.match(setCookie, /HttpOnly/);
    assert.match(setCookie, /SameSite=Strict/);
    assert.match(setCookie, /Path=\/api\/v1\/auth/);
    const first = setCookie.split(";")[0];

    const r1 = await app.call("POST", `${API}/auth/refresh`, { cookie: first });
    assert.equal(r1.status, 200);
    const second = r1.headers.get("set-cookie").split(";")[0];
    assert.notEqual(first, second);

    // Replaying the first (already rotated) token kills the whole family...
    const replay = await app.call("POST", `${API}/auth/refresh`, { cookie: first });
    assert.equal(replay.status, 401);
    // ...including the newest token.
    const after = await app.call("POST", `${API}/auth/refresh`, { cookie: second });
    assert.equal(after.status, 401);
  });

  test("logout revokes the session", async () => {
    const login = await app.call("POST", `${API}/auth/login`, {
      body: { email: "bob@example.com", password: "correct-horse-battery" },
    });
    const c = login.headers.get("set-cookie").split(";")[0];
    assert.equal((await app.call("POST", `${API}/auth/logout`, { cookie: c })).status, 204);
    assert.equal((await app.call("POST", `${API}/auth/refresh`, { cookie: c })).status, 401);
  });

  test("tokens are required and roles are enforced on the server", async () => {
    assert.equal((await app.call("GET", `${API}/me`)).status, 401);
    assert.equal((await app.call("GET", `${API}/me`, { token: "garbage" })).status, 401);
    const r = await app.call("POST", `${API}/services`, {
      token: alice.token,
      body: { name: "Hack", durationMin: 10, priceCents: 1 },
    });
    assert.equal(r.status, 403);
  });
});

describe("services", () => {
  before(async () => {
    for (const [name, durationMin, priceCents] of [
      ["Beard trim", 15, 1000],
      ["Colour", 90, 5500],
      ["Kids 100% cut", 20, 1200],
    ]) {
      await app.call("POST", `${API}/services`, { token: owner.token, body: { name, durationMin, priceCents } });
    }
  });

  test("search, sort and pagination", async () => {
    const r = await app.call("GET", `${API}/services?sort=price&order=desc&limit=2&page=1`);
    assert.equal(r.status, 200);
    assert.equal(r.body.total, 4);
    assert.equal(r.body.totalPages, 2);
    assert.deepEqual(
      r.body.data.map((s) => s.name),
      ["Colour", "Haircut"],
    );
    const q = await app.call("GET", `${API}/services?q=${encodeURIComponent("100%")}`);
    assert.deepEqual(
      q.body.data.map((s) => s.name),
      ["Kids 100% cut"],
      "LIKE wildcards are matched literally",
    );
  });

  test("archiving hides a service from the public but not from the owner", async () => {
    const s = (
      await app.call("POST", `${API}/services`, {
        token: owner.token,
        body: { name: "Old", durationMin: 10, priceCents: 1 },
      })
    ).body;
    assert.equal((await app.call("DELETE", `${API}/services/${s.id}`, { token: owner.token })).status, 204);
    assert.equal((await app.call("GET", `${API}/services/${s.id}`)).status, 404);
    const all = await app.call("GET", `${API}/services?status=archived`, { token: owner.token });
    assert.deepEqual(
      all.body.data.map((x) => x.name),
      ["Old"],
    );
    const pub = await app.call("GET", `${API}/services?status=archived`);
    assert.ok(!pub.body.data.some((x) => x.name === "Old"));
  });

  test("durations must be multiples of 5", async () => {
    const r = await app.call("POST", `${API}/services`, {
      token: owner.token,
      body: { name: "Odd", durationMin: 7, priceCents: 1 },
    });
    assert.equal(r.status, 400);
  });
});

describe("staff", () => {
  test("overlapping hours are rejected", async () => {
    const r = await app.call("PUT", `${API}/staff/${staffUser.id}/hours`, {
      token: owner.token,
      body: {
        hours: [
          { weekday: 1, start: "09:00", end: "12:00" },
          { weekday: 1, start: "11:00", end: "13:00" },
        ],
      },
    });
    assert.equal(r.status, 400);
  });

  test("promoting an unknown email explains what to do", async () => {
    const r = await app.call("POST", `${API}/staff`, {
      token: owner.token,
      body: { email: "nobody@example.com", displayName: "N" },
    });
    assert.equal(r.status, 404);
    assert.equal(r.body.error.code, "account_not_found");
  });
});

describe("availability and bookings", () => {
  test("availability lists 30-minute slots inside working hours", async () => {
    const r = await app.call("GET", `${API}/availability?serviceId=${service.id}&date=${day.date}`);
    assert.equal(r.status, 200);
    const starts = r.body.slots.map((s) => s.startsAt.slice(11, 16));
    assert.equal(starts[0], "09:00");
    assert.equal(starts.at(-1), "16:30");
    assert.equal(starts.length, 31); // 09:00..16:30 every 15 minutes
  });

  test("two people racing for the same slot: exactly one wins", async () => {
    const results = await Promise.all([book(alice, "11:30"), book(bob, "11:30"), book(bob, "11:45")]);
    const codes = results.map((r) => r.status).sort();
    assert.deepEqual(codes, [201, 409, 409]);
    const losers = results.filter((r) => r.status === 409).map((r) => r.body.error.code);
    assert.ok(losers.includes("slot_taken"));
    // Clean up so later tests don't depend on who won.
    const winner = results.find((r) => r.status === 201).body;
    assert.equal((await app.call("POST", `${API}/bookings/${winner.id}/cancel`, { token: owner.token })).status, 200);
  });

  test("booked times disappear from availability", async () => {
    assert.equal((await book(alice, "10:00")).status, 201);
    const r = await app.call("GET", `${API}/availability?serviceId=${service.id}&date=${day.date}`);
    const starts = r.body.slots.map((s) => s.startsAt.slice(11, 16));
    for (const t of ["09:45", "10:00", "10:15"]) assert.ok(!starts.includes(t), `${t} should be gone`);
    assert.ok(starts.includes("09:30") && starts.includes("10:30"));
  });

  test("the server rejects times outside hours, in the past, or misaligned", async () => {
    assert.equal((await book(alice, "16:45")).body.error.code, "outside_hours"); // would end 17:15
    assert.equal((await book(alice, "07:00")).body.error.code, "outside_hours");
    assert.equal((await book(alice, "12:07")).status, 400);
    const past = await app.call("POST", `${API}/bookings`, {
      token: alice.token,
      body: { serviceId: service.id, staffId: staffUser.id, startsAt: "2020-01-01T10:00:00Z" },
    });
    assert.equal(past.status, 400);
  });

  test("a customer can't hold two overlapping bookings", async () => {
    const svc2 = (await app.call("GET", `${API}/services?q=Beard`)).body.data[0];
    await app.call("PATCH", `${API}/staff/${staffUser.id}`, {
      token: owner.token,
      body: { serviceIds: [service.id, svc2.id] },
    });
    const r = await app.call("POST", `${API}/bookings`, {
      token: alice.token,
      body: { serviceId: svc2.id, staffId: staffUser.id, startsAt: at("10:15") },
    });
    assert.equal(r.status, 409);
  });

  test("visibility: customers see their own, staff see theirs, owner sees all", async () => {
    await book(bob, "13:00");
    const mine = await app.call("GET", `${API}/bookings`, { token: alice.token });
    assert.ok(mine.body.data.every((b) => b.customer.id === alice.id));
    assert.equal(mine.body.data[0].customer.email, undefined, "customers don't get contact fields");
    const bobs = await app.call("GET", `${API}/bookings`, { token: bob.token });
    const other = await app.call("GET", `${API}/bookings/${bobs.body.data[0].id}`, { token: alice.token });
    assert.equal(other.status, 404, "another customer's booking looks like it doesn't exist");
    const staffView = await app.call("GET", `${API}/bookings?status=confirmed`, { token: staffUser.token });
    assert.equal(staffView.body.total, 2);
    assert.ok(staffView.body.data[0].customer.email);
    const ownerView = await app.call(
      "GET",
      `${API}/bookings?status=confirmed&from=${day.date}&to=${day.date}&sort=starts&order=asc`,
      { token: owner.token },
    );
    assert.deepEqual(
      ownerView.body.data.map((b) => b.startsAt.slice(11, 16)),
      ["10:00", "13:00"],
    );
    assert.equal(
      (await app.call("GET", `${API}/bookings?staffId=${staffUser.id}`, { token: alice.token })).status,
      403,
    );
  });

  test("cancelling: allowed before the cutoff, frees the slot, can't repeat", async () => {
    const b = (await app.call("GET", `${API}/bookings?status=confirmed`, { token: alice.token })).body.data[0];
    const c = await app.call("POST", `${API}/bookings/${b.id}/cancel`, {
      token: alice.token,
      body: { reason: "Sick" },
    });
    assert.equal(c.status, 200);
    assert.equal(c.body.status, "cancelled");
    assert.equal((await app.call("POST", `${API}/bookings/${b.id}/cancel`, { token: alice.token })).status, 409);
    assert.equal((await book(bob, "10:00")).status, 201, "slot is free again");
  });

  test("late cancellation is blocked for customers; completion only after the start", async () => {
    // Insert a booking starting in 30 minutes directly, bypassing the lead-time rule.
    const soon = new Date(Date.now() + 30 * 60_000);
    soon.setUTCSeconds(0, 0);
    const { rows } = await app.db.query(
      `insert into bookings (customer_id, staff_id, service_id, starts_at, ends_at, price_cents)
       values ($1, $2, $3, $4, $4::timestamptz + interval '30 minutes', 2000) returning id`,
      [alice.id, staffUser.id, service.id, soon],
    );
    const late = await app.call("POST", `${API}/bookings/${rows[0].id}/cancel`, { token: alice.token });
    assert.equal(late.body.error.code, "too_late");
    const early = await app.call("POST", `${API}/bookings/${rows[0].id}/complete`, { token: staffUser.token });
    assert.equal(early.body.error.code, "not_started");
    assert.equal(
      (await app.call("POST", `${API}/bookings/${rows[0].id}/complete`, { token: alice.token })).status,
      403,
    );

    const past = await app.db.query(
      `insert into bookings (customer_id, staff_id, service_id, starts_at, ends_at, price_cents)
       values ($1, $2, $3, now() - interval '2 hours', now() - interval '90 minutes', 2000) returning id`,
      [alice.id, staffUser.id, service.id],
    );
    const done = await app.call("POST", `${API}/bookings/${past.rows[0].id}/no-show`, { token: staffUser.token });
    assert.equal(done.status, 200);
    assert.equal(done.body.status, "no_show");
  });
});

describe("account", () => {
  test("update profile, change password signs out other sessions, delete account", async () => {
    const u = await app.user("carla@example.com");
    const p = await app.call("PATCH", `${API}/me`, {
      token: u.token,
      body: { name: "Carla R.", phone: "+39 333 123 4567" },
    });
    assert.equal(p.body.name, "Carla R.");
    assert.equal((await app.call("PATCH", `${API}/me`, { token: u.token, body: { role: "owner" } })).status, 422);

    const wrong = await app.call("POST", `${API}/me/password`, {
      token: u.token,
      body: { currentPassword: "nope-nope-nope", newPassword: "brand-new-password" },
    });
    assert.equal(wrong.status, 401);
    const ch = await app.call("POST", `${API}/me/password`, {
      token: u.token,
      body: { currentPassword: "correct-horse-battery", newPassword: "brand-new-password" },
    });
    assert.equal(ch.status, 204);
    assert.equal((await app.call("POST", `${API}/auth/refresh`, { cookie: u.cookie })).status, 401);

    assert.equal(
      (await app.call("DELETE", `${API}/me`, { token: u.token, body: { password: "brand-new-password" } })).status,
      204,
    );
    assert.equal(
      (await app.call("GET", `${API}/me`, { token: u.token })).status,
      401,
      "deleted users' tokens stop working at once",
    );
    assert.equal(
      (await app.call("DELETE", `${API}/me`, { token: owner.token, body: { password: "correct-horse-battery" } }))
        .status,
      409,
    );
  });
});

describe("rate limiting", () => {
  test("auth endpoints are limited per client", async () => {
    const limited = await startTestApp({ RATE_LIMIT_AUTH_PER_MIN: "3" });
    try {
      const codes = [];
      for (let i = 0; i < 5; i++) {
        codes.push(
          (
            await limited.call("POST", `${API}/auth/login`, {
              body: { email: "x@example.com", password: "whatever-pass" },
            })
          ).status,
        );
      }
      assert.deepEqual(codes, [401, 401, 401, 429, 429]);
      const r = await limited.call("POST", `${API}/auth/login`, {
        body: { email: "x@example.com", password: "whatever-pass" },
      });
      assert.ok(Number(r.headers.get("retry-after")) > 0);
    } finally {
      await limited.close();
    }
  });
});
