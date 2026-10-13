// Browser tests against the built site with production headers (CSP enforced).
// npm run build && npm install --no-save playwright && npx playwright install chromium && npm run test:e2e
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { serve } from "../scripts/serve.mjs";

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
// Set when dist/ was built with REPO_URL (source code public on GitHub).
const REPO_URL = process.env.REPO_URL || null;
let server, browser, BASE;
const LANGS = ["en", "it", "fr", "ar"];
const SLUGS = ["hyperlean-rag-assistant", "buongusto-aspio", "slotbook", "hostwatch", "prontix", "shipyard", "stepvia"];
const PAGES = [
  "/",
  ...LANGS.flatMap((l) => [
    `/${l}/`,
    `/${l}/projects/`,
    `/${l}/cv/`,
    `/${l}/privacy/`,
    ...SLUGS.map((s) => `/${l}/projects/${s}/`),
  ]),
];

// The site loads nothing from third parties, so any failed request is a real error.
const ignorable = () => false;

before(async () => {
  server = await serve(0);
  BASE = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch();
});
after(async () => {
  await browser?.close();
  server?.close();
});

async function open(path, opts = {}) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, ...opts });
  const problems = [];
  page.on("console", (m) => {
    if (m.type() === "error" && !ignorable(m.text())) problems.push(m.text());
  });
  page.on("pageerror", (e) => problems.push(e.message));
  page.on("requestfailed", (r) => {
    if (!ignorable(r.url())) problems.push(`failed: ${r.url()}`);
  });
  await page.goto(BASE + path, { waitUntil: "load" });
  return { page, problems };
}

test("every page loads without errors or CSP violations, and fits a phone screen", async () => {
  for (const path of PAGES) {
    const { page, problems } = await open(path, { viewport: { width: 360, height: 740 } });
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth),
      false,
      `${path} scrolls sideways at 360px`,
    );
    assert.deepEqual(problems, [], path);
    await page.close();
  }
});

test("project filters show matching projects, an explained empty state, and keep the choice in the URL", async () => {
  const { page } = await open("/en/projects/");
  const visible = () => page.locator("li.project-row:visible h2").allTextContents();
  assert.equal((await visible()).length, 7);
  await page.getByRole("button", { name: /^Cloud\/DevOps/ }).click();
  assert.deepEqual((await visible()).sort(), ["Hostwatch", "RAG assistant for industrial cost estimation", "Shipyard"]);
  assert.match(page.url(), /category=cloud/);
  assert.equal(await page.getByRole("button", { name: /^Cloud\/DevOps/ }).getAttribute("aria-pressed"), "true");
  await page.getByRole("button", { name: /^Open Source/ }).click();
  if (REPO_URL) {
    // Built with a public repository: the projects whose code is in it are open source.
    assert.deepEqual((await visible()).sort(), ["Hostwatch", "Shipyard", "Slotbook"]);
  } else {
    assert.equal((await visible()).length, 0);
    await page.getByText("Nothing published as open source yet").waitFor();
  }
  await page.goto(`${BASE}/en/projects/?category=ai`);
  assert.deepEqual((await visible()).sort(), [
    "Pizzeria Buon Gusto",
    "Prontix",
    "RAG assistant for industrial cost estimation",
  ]);
  await page.close();
});

test("without JavaScript every project is still listed", async () => {
  const ctx = await browser.newContext({ javaScriptEnabled: false });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/it/projects/`);
  assert.equal(await page.locator("li.project-row").count(), 7);
  assert.equal(await page.locator("[data-filters]").isVisible(), false, "filters stay hidden without JS");
  await ctx.close();
});

test("theme toggle cycles system → light → dark and persists", async () => {
  const { page } = await open("/en/");
  const toggle = page.getByRole("button", { name: /Theme:/ });
  await toggle.click();
  assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), "light");
  await toggle.click();
  assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), "dark");
  await page.reload();
  assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), "dark", "remembered after reload");
  const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  assert.equal(bg, "rgb(15, 23, 32)");
  await page.close();
});

test("mobile menu opens, closes with Escape and returns focus", async () => {
  const { page } = await open("/en/", { viewport: { width: 390, height: 800 } });
  const btn = page.getByRole("button", { name: "Menu" });
  await btn.click();
  assert.equal(await btn.getAttribute("aria-expanded"), "true");
  assert.ok(await page.getByRole("link", { name: "Projects", exact: true }).isVisible());
  await page.keyboard.press("Escape");
  assert.equal(await btn.getAttribute("aria-expanded"), "false");
  assert.equal(await page.evaluate(() => document.activeElement?.textContent?.trim()), "Menu");
  await page.close();
});

test("keyboard: the first Tab reaches the skip link, which moves focus to the content", async () => {
  const { page } = await open("/en/");
  await page.keyboard.press("Tab");
  assert.equal(await page.evaluate(() => document.activeElement?.textContent?.trim()), "Skip to content");
  await page.keyboard.press("Enter");
  assert.equal(await page.evaluate(() => document.activeElement?.id), "main");
  await page.close();
});

test("case-study screenshots load and decode", async () => {
  for (const path of ["/en/projects/slotbook/", "/ar/projects/hostwatch/"]) {
    const { page } = await open(path);
    const imgs = page.locator("figure.shot img");
    for (let i = 0; i < (await imgs.count()); i++) {
      await imgs.nth(i).scrollIntoViewIfNeeded();
      await page.waitForFunction((el) => el.complete && el.naturalWidth > 0, await imgs.nth(i).elementHandle());
    }
    await page.close();
  }
});

test("case studies render their diagram and evidence table", async () => {
  const { page } = await open("/en/projects/slotbook/");
  assert.ok(await page.getByRole("img", { name: "Slotbook request path" }).isVisible());
  assert.ok((await page.locator("table.ledger tbody tr").count()) >= 4);
  await page.close();
});

test("language switcher keeps the current page, remembers the choice and Arabic is right-to-left", async () => {
  const { page } = await open("/en/projects/slotbook/");
  await page.locator('.langs a[data-lang="ar"]').click();
  await page.waitForURL(/\/ar\/projects\/slotbook\/$/);
  assert.equal(await page.evaluate(() => document.documentElement.dir), "rtl");
  assert.equal(await page.evaluate(() => getComputedStyle(document.body).direction), "rtl");
  const cookies = await page.context().cookies();
  assert.equal(cookies.find((c) => c.name === "nf_lang")?.value, "ar");
  // Code and the architecture diagram stay left-to-right inside the Arabic page.
  assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector(".diagram-scroll")).direction), "ltr");
  await page.close();
});

test("contact form requires name, a valid email and a message before sending", async () => {
  for (const l of LANGS) {
    const { page } = await open(`/${l}/`);
    const form = page.locator('form[name="contact"]');
    assert.equal(await form.evaluate((f) => f.checkValidity()), false, `${l}: empty form is invalid`);
    await page.fill("#cf-name", "Test");
    await page.fill("#cf-email", "not-an-email");
    await page.fill("#cf-message", "Hello, a short test message.");
    assert.equal(await form.evaluate((f) => f.checkValidity()), false, `${l}: bad email is invalid`);
    await page.fill("#cf-email", "test@example.com");
    assert.equal(await form.evaluate((f) => f.checkValidity()), true, `${l}: filled form is valid`);
    const hp = await page.locator(".hp").boundingBox();
    assert.ok(hp.x + hp.width <= 0 || hp.x >= page.viewportSize().width, `${l}: honeypot is off-screen`);
    await page.close();
  }
});

test("each language's CV PDF is linked and served", async () => {
  for (const l of LANGS) {
    const { page } = await open(`/${l}/cv/`);
    const href = await page.locator(`a[href="/cv-ahmad-kassar-${l}.pdf"]`).first().getAttribute("href");
    const res = await page.request.get(BASE + href);
    assert.equal(res.status(), 200);
    assert.equal((await res.body()).subarray(0, 4).toString(), "%PDF");
    await page.close();
  }
});

test("filters: every category in every language matches the data, survives refresh and back/forward", async () => {
  const { contentFor, withPublishedSource } = await import("../scripts/build.mjs");
  const cats = ["full-stack", "backend", "frontend", "cloud", "ai", "open-source"];
  for (const l of LANGS) {
    const expected = Object.fromEntries(
      cats.map((c) => [
        c,
        withPublishedSource(contentFor(l), { repoUrl: REPO_URL })
          .projects.filter((p) => p.categories.includes(c))
          .map((p) => p.title)
          .sort(),
      ]),
    );
    const { page, problems } = await open(`/${l}/projects/`);
    const visible = async () =>
      (await page.locator("li.project-row:visible h2").allTextContents()).map((s) => s.trim()).sort();
    const pressed = () => page.locator('[data-filters] button[aria-pressed="true"]').getAttribute("data-filter");
    assert.equal((await visible()).length, 7, `${l}: all projects at start`);
    for (const c of cats) {
      // Direct navigation
      await page.goto(`${BASE}/${l}/projects/?category=${c}`);
      assert.deepEqual(await visible(), expected[c], `${l} ${c}: direct link`);
      assert.equal(await pressed(), c);
      // The chip's number equals what is shown
      const n = await page.locator(`[data-filters] button[data-filter="${c}"] .n`).textContent();
      assert.equal(Number(n), expected[c].length, `${l} ${c}: chip count`);
      const emptyVisible = await page.locator("[data-empty]").isVisible();
      assert.equal(emptyVisible, expected[c].length === 0, `${l} ${c}: empty state only when nothing matches`);
      // Refresh keeps it
      await page.reload();
      assert.deepEqual(await visible(), expected[c], `${l} ${c}: after reload`);
    }
    // Clicking pushes history; back/forward restore the selection
    await page.goto(`${BASE}/${l}/projects/`);
    await page.locator('[data-filters] button[data-filter="backend"]').click();
    await page.locator('[data-filters] button[data-filter="frontend"]').click();
    assert.match(page.url(), /category=frontend$/);
    await page.goBack();
    assert.match(page.url(), /category=backend$/);
    assert.deepEqual(await visible(), expected.backend, `${l}: back`);
    assert.equal(await pressed(), "backend");
    await page.goBack();
    assert.doesNotMatch(page.url(), /category=/);
    assert.equal((await visible()).length, 7, `${l}: back to all`);
    await page.goForward();
    assert.deepEqual(await visible(), expected.backend, `${l}: forward`);
    // Empty state offers a way back to everything (only reachable while no category is empty-free)
    if (expected["open-source"].length === 0) {
      await page.locator('[data-filters] button[data-filter="open-source"]').click();
      await page.locator("[data-empty] button").click();
      assert.equal((await visible()).length, 7, `${l}: show all from empty state`);
      assert.doesNotMatch(page.url(), /category=/);
    }
    // Unknown categories fall back to all and are removed from the URL
    await page.goto(`${BASE}/${l}/projects/?category=nonsense`);
    assert.equal((await visible()).length, 7);
    assert.doesNotMatch(page.url(), /category=/);
    assert.deepEqual(problems, [], l);
    await page.close();
  }
});

test("filters: the HTML never contains empty-state text that contradicts the listed projects", async () => {
  // Crawlers, reader modes and text extractors ignore [hidden]; the message must only exist after JS decides.
  const ctx = await browser.newContext({ javaScriptEnabled: false });
  const page = await ctx.newPage();
  for (const l of LANGS) {
    await page.goto(`${BASE}/${l}/projects/?category=frontend`);
    assert.equal((await page.locator("[data-empty-text]").textContent()).trim(), "", l);
    assert.match(await page.locator("[data-count]").textContent(), /7/, `${l}: count rendered without JS`);
  }
  await ctx.close();
});

// WCAG 2.2 AA: 4.5:1 for normal text, 3:1 for large text (24px, or 18.66px bold).
async function contrastProblems(page) {
  return page.evaluate(() => {
    const parse = (c) => {
      const m = c.match(/rgba?\(([^)]+)\)/);
      if (!m) return null;
      const [r, g, b, a = 1] = m[1]
        .split(/[ ,/]+/)
        .filter(Boolean)
        .map(Number);
      return { r, g, b, a };
    };
    const lum = ({ r, g, b }) => {
      const f = (v) => ((v /= 255) <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
      return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
    };
    const bgOf = (el) => {
      const layers = [];
      for (let e = el; e; e = e.parentElement) {
        const c = parse(getComputedStyle(e).backgroundColor);
        if (c && c.a > 0) {
          layers.push(c);
          if (c.a === 1) break;
        }
      }
      let out = { r: 255, g: 255, b: 255 };
      for (const c of layers.reverse())
        out = { r: c.r * c.a + out.r * (1 - c.a), g: c.g * c.a + out.g * (1 - c.a), b: c.b * c.a + out.b * (1 - c.a) };
      return out;
    };
    const bad = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    const seen = new Set();
    while (walker.nextNode()) {
      const el = walker.currentNode.parentElement;
      if (!el || seen.has(el) || !walker.currentNode.textContent.trim()) continue;
      seen.add(el);
      if (el.closest(".sr-only, .hp, svg, [aria-hidden='true']") || el.offsetParent === null) continue;
      const s = getComputedStyle(el);
      if (s.visibility === "hidden" || Number(s.opacity) < 0.99) continue;
      const fg = parse(s.color);
      if (!fg) continue;
      const bg = bgOf(el);
      const blended = {
        r: fg.r * fg.a + bg.r * (1 - fg.a),
        g: fg.g * fg.a + bg.g * (1 - fg.a),
        b: fg.b * fg.a + bg.b * (1 - fg.a),
      };
      const [l1, l2] = [lum(blended), lum(bg)].sort((a, b) => b - a);
      const ratio = (l1 + 0.05) / (l2 + 0.05);
      const size = parseFloat(s.fontSize);
      const large = size >= 24 || (size >= 18.66 && Number(s.fontWeight) >= 700);
      if (ratio < (large ? 3 : 4.5))
        bad.push(`${ratio.toFixed(2)} "${walker.currentNode.textContent.trim().slice(0, 40)}"`);
    }
    return bad;
  });
}

test("accessibility: text contrast meets WCAG AA in light and dark, in every language", async () => {
  const paths = ["/", "/projects/", "/cv/", "/projects/slotbook/", "/projects/hyperlean-rag-assistant/", "/privacy/"];
  for (const scheme of ["light", "dark"]) {
    for (const l of LANGS) {
      for (const p of paths) {
        const page = await browser.newPage({ colorScheme: scheme, reducedMotion: "reduce" });
        await page.goto(`${BASE}/${l}${p}`);
        const bad = await contrastProblems(page);
        assert.deepEqual(bad, [], `${scheme} /${l}${p}`);
        await page.close();
      }
    }
  }
});

test("accessibility: every link, button and form control has an accessible name", async () => {
  for (const l of LANGS) {
    for (const p of ["/", "/projects/", "/projects/buongusto-aspio/"]) {
      const { page } = await open(`/${l}${p}`);
      const unnamed = await page.evaluate(() =>
        [...document.querySelectorAll("a[href], button, input:not([type=hidden]), textarea, select")]
          .filter((el) => !el.closest(".hp"))
          .filter((el) => {
            const label = el.id && document.querySelector(`label[for="${el.id}"]`);
            const name = (
              el.getAttribute("aria-label") ||
              el.textContent ||
              label?.textContent ||
              el.getAttribute("title") ||
              ""
            ).trim();
            return !name;
          })
          .map((el) => el.outerHTML.slice(0, 80)),
      );
      assert.deepEqual(unnamed, [], `/${l}${p}`);
      await page.close();
    }
  }
});

test(
  "case studies link to their source on GitHub once the repository is public",
  { skip: !REPO_URL && "built without REPO_URL" },
  async () => {
    for (const [slug, dir] of [
      ["slotbook", "slotbook"],
      ["hostwatch", "hostwatch"],
      ["shipyard", "shipyard"],
    ]) {
      const { page } = await open(`/en/projects/${slug}/`);
      const href = await page.locator(`a[href="${REPO_URL}/tree/main/projects/${dir}"]`).first().getAttribute("href");
      assert.ok(href, slug);
      await page.close();
    }
  },
);
