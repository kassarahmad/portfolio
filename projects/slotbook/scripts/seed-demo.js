// Fictional demo data for local development. Names are invented and marked
// "(demo)". Passwords are random per run and printed once.
import crypto from "node:crypto";
import { hashPassword } from "../src/lib/crypto.js";

const SERVICES = [
  ["Haircut", "Wash, cut and style.", 30, 2000],
  ["Beard trim", "Shape and hot towel.", 15, 1000],
  ["Cut and beard", "Both, in one visit.", 45, 2800],
  ["Colour", "Full colour with consultation.", 90, 5500],
];
/** @type {Array<[string, string, number[], Array<[number, string, string]>]>} */
const STAFF = [
  [
    "giulia.demo@example.com",
    "Giulia (demo)",
    [0, 1, 2, 3],
    [
      [1, "09:00", "13:00"],
      [1, "14:00", "18:00"],
      [2, "09:00", "13:00"],
      [2, "14:00", "18:00"],
      [4, "10:00", "19:00"],
      [5, "09:00", "13:00"],
      [6, "09:00", "13:00"],
    ],
  ],
  [
    "marco.demo@example.com",
    "Marco (demo)",
    [0, 1, 2],
    [
      [2, "12:00", "20:00"],
      [3, "09:00", "17:00"],
      [4, "09:00", "17:00"],
      [5, "12:00", "20:00"],
      [6, "09:00", "14:00"],
    ],
  ],
];

export async function seedDemo(db) {
  const pw = () => crypto.randomBytes(9).toString("base64url");
  const creds = [];
  await db.tx(async (c) => {
    const ids = [];
    for (const [name, description, dur, price] of SERVICES) {
      const { rows } = await c.query(
        `insert into services (name, description, duration_min, price_cents) values ($1, $2, $3, $4)
         on conflict (name) do update set description = excluded.description returning id`,
        [name, description, dur, price],
      );
      ids.push(rows[0].id);
    }
    for (const [email, display, svc, hours] of STAFF) {
      const password = pw();
      creds.push([email, password, "staff"]);
      const { rows } = await c.query(
        `insert into users (email, password_hash, name, role) values ($1, $2, $3, 'staff')
         on conflict (email) do update set password_hash = excluded.password_hash, role = 'staff' returning id`,
        [email, await hashPassword(password), display],
      );
      const uid = rows[0].id;
      await c.query(
        `insert into staff_profiles (user_id, display_name, bio) values ($1, $2, 'Fictional staff member for the demo.')
         on conflict (user_id) do update set display_name = excluded.display_name, active = true`,
        [uid, display],
      );
      await c.query("delete from staff_services where staff_id = $1", [uid]);
      for (const i of svc) await c.query("insert into staff_services values ($1, $2)", [uid, ids[i]]);
      await c.query("delete from working_hours where staff_id = $1", [uid]);
      for (const [d, s, e] of hours) {
        await c.query("insert into working_hours (staff_id, weekday, start_time, end_time) values ($1, $2, $3, $4)", [
          uid,
          d,
          s,
          e,
        ]);
      }
    }
    const password = pw();
    creds.push(["customer.demo@example.com", password, "customer"]);
    await c.query(
      `insert into users (email, password_hash, name) values ($1, $2, 'Demo Customer')
       on conflict (email) do update set password_hash = excluded.password_hash`,
      ["customer.demo@example.com", await hashPassword(password)],
    );
  });
  return [
    "Demo data ready (fictional). Sign-ins for this run:",
    ...creds.map(([e, p, r]) => `  ${r.padEnd(8)} ${e}  ${p}`),
    "Create an owner with: SLOTBOOK_OWNER_PASSWORD=... node scripts/cli.js create-owner you@example.com",
  ].join("\n");
}
