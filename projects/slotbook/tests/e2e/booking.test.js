// Browser journey against a running server with demo data (npm run seed:demo).
// Requires Playwright: npm install --no-save playwright && npx playwright install chromium
// Run: SLOTBOOK_URL=http://localhost:3000 npm run test:e2e
/* global document, window */
import { after, before, test } from "node:test";
import assert from "node:assert/strict";

const BASE = process.env.SLOTBOOK_URL || "http://localhost:3000";
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
let browser, page;
const errors = [];

before(async () => {
  browser = await chromium.launch();
  page = await browser.newPage({ viewport: { width: 390, height: 844 } }); // phone-sized
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
});
after(() => browser?.close());

async function firstDayWithSlots() {
  const services = await (await fetch(`${BASE}/api/v1/services?q=Haircut`)).json();
  const svc = services.data.find((s) => s.name === "Haircut");
  for (let i = 1; i <= 14; i++) {
    const date = new Date(Date.now() + i * 86_400_000).toISOString().slice(0, 10);
    const a = await (await fetch(`${BASE}/api/v1/availability?serviceId=${svc.id}&date=${date}`)).json();
    if (a.slots.length) return date;
  }
  throw new Error("No availability in the next two weeks: did you run the demo seed?");
}

test("a new customer books and then cancels an appointment", async () => {
  const date = await firstDayWithSlots();
  const email = `e2e-${Date.now()}@example.com`;

  await page.goto(`${BASE}/#/account`);
  await page.getByRole("button", { name: "Create an account" }).click();
  await page.getByLabel("Name").fill("E2E Customer");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("e2e-password-123");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.getByRole("heading", { name: "Book an appointment" }).waitFor();

  await page
    .getByRole("button", { name: /Haircut/ })
    .first()
    .click();
  await page.getByLabel("Date").fill(date);
  await page.getByLabel("Date").dispatchEvent("change");
  const slot = page.locator(".slot").first();
  await slot.waitFor();
  const slotLabel = await slot.getAttribute("aria-label");
  await slot.click();
  await page.getByRole("button", { name: "Confirm booking" }).click();

  await page.getByRole("heading", { name: "My bookings" }).waitFor();
  await assert.doesNotReject(page.getByText("Haircut").first().waitFor());
  assert.ok(await page.getByText("Confirmed", { exact: true }).isVisible(), `booked ${slotLabel}`);

  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "Cancel booking" }).click();
  await page.getByText("Cancelled", { exact: true }).waitFor();

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  assert.equal(overflow, false, "no horizontal scroll at phone width");
  assert.deepEqual(errors, []);
});

test("validation errors are shown next to the field", async () => {
  await page.goto(`${BASE}/#/account`);
  const signOut = page.getByRole("button", { name: "Sign out" });
  if (await signOut.isVisible()) {
    await signOut.click();
    await page.getByRole("heading", { name: "Book an appointment" }).waitFor();
  }
  await page.getByRole("link", { name: "Sign in" }).click();
  await page.getByRole("button", { name: "Create an account" }).click();
  await page.getByLabel("Name").fill("X");
  await page.getByLabel("Email").fill("not-an-email");
  await page.getByLabel("Password").fill("short");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.getByText("This field must be a valid email address.").waitFor();
  await page.getByText("This field must be at least 10 characters.").waitFor();
});
