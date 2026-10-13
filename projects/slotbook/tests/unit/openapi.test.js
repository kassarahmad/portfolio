import { test } from "node:test";
import assert from "node:assert/strict";
import { Router } from "../../src/http/router.js";
import { registerAuth } from "../../src/modules/auth.js";
import { registerMe } from "../../src/modules/me.js";
import { registerServices } from "../../src/modules/services.js";
import { registerStaff } from "../../src/modules/staff.js";
import { registerBookings } from "../../src/modules/bookings.js";
import { openapi } from "../../src/openapi.js";

test("every route is documented in OpenAPI and nothing undocumented is exposed", () => {
  const r = new Router("");
  const deps = { db: null, config: { businessTz: "UTC" }, log: null };
  [registerAuth, registerMe, registerServices, registerStaff, registerBookings].forEach((f) => f(r, deps));
  r.get("/health", () => {});
  r.get("/openapi.json", () => {});

  const routes = new Set(r.routes.map((x) => `${x.method} ${x.path.replace(/:(\w+)/g, "{$1}")}`));
  const documented = new Set();
  for (const [p, ops] of Object.entries(openapi.paths)) {
    for (const m of Object.keys(ops)) if (m !== "parameters") documented.add(`${m.toUpperCase()} ${p}`);
  }
  assert.deepEqual(
    [...routes].filter((x) => !documented.has(x)),
    [],
    "routes missing from the spec",
  );
  assert.deepEqual(
    [...documented].filter((x) => !routes.has(x)),
    [],
    "spec entries with no route",
  );
});

test("every $ref resolves", () => {
  const refs = JSON.stringify(openapi).match(/#\/components\/schemas\/\w+/g) ?? [];
  for (const ref of new Set(refs)) {
    const name = ref.split("/").pop();
    assert.ok(openapi.components.schemas[name], `missing schema ${name}`);
  }
});
