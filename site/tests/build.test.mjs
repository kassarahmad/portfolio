import { before, test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { baseContent, build, contentFor, projects, siteConfig, withPublishedSource } from "../scripts/build.mjs";
import { LANGS } from "../src/i18n/ui.mjs";

const LANG_CODES = Object.keys(LANGS);

const REPO = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const OUT = path.join(tmpdir(), `portfolio-test-${process.pid}`);
let result;
const pages = {};

const walk = (dir) =>
  readdirSync(dir, { withFileTypes: true }).flatMap((d) =>
    d.isDirectory() ? walk(path.join(dir, d.name)) : [path.join(dir, d.name)],
  );

before(async () => {
  result = await build({ env: { SITE_URL: "https://portfolio.example" }, out: OUT });
  for (const f of walk(OUT).filter((f) => f.endsWith(".html"))) pages[f.slice(OUT.length)] = readFileSync(f, "utf8");
});

test("every page and every project with a slug is built in every language", () => {
  const files = Object.keys(pages).sort();
  assert.ok(files.includes("/index.html"), "language chooser");
  for (const l of LANG_CODES) {
    for (const f of [
      "index.html",
      "404.html",
      "cv/index.html",
      "projects/index.html",
      "privacy/index.html",
      "thanks/index.html",
    ])
      assert.ok(files.includes(`/${l}/${f}`), `/${l}/${f}`);
    for (const p of projects.filter((x) => x.slug))
      assert.ok(files.includes(`/${l}/projects/${p.slug}/index.html`), `${l}: ${p.slug}`);
  }
});

test("translations are complete and actually translated", () => {
  const en = JSON.stringify(baseContent());
  for (const l of LANG_CODES.filter((x) => x !== "en")) {
    const c = contentFor(l); // throws on a missing string
    assert.notEqual(c.profile.lede, JSON.parse(en).profile.lede, `${l}: lede untranslated`);
    for (const p of c.projects) assert.ok(p.title && p.summary, `${l}: ${p.slug}`);
  }
});

test("language, direction, hreflang and the language switcher are right", () => {
  for (const l of LANG_CODES) {
    const h = pages[`/${l}/index.html`];
    assert.match(h, new RegExp(`<html lang="${LANGS[l].htmlLang}" dir="${LANGS[l].dir}">`), l);
    for (const o of LANG_CODES)
      assert.match(h, new RegExp(`hreflang="${o}" href="https://portfolio\\.example/${o}/"`), `${l} -> ${o}`);
    assert.match(h, /hreflang="x-default"/);
    assert.match(h, new RegExp(`data-lang="${l}"\\s+aria-current="true"`), `${l}: current language marked`);
  }
  assert.match(pages["/ar/index.html"], /dir="rtl"/);
});

test("redirects send / to the visitor's language and keep old URLs working", () => {
  const r = readFileSync(path.join(OUT, "_redirects"), "utf8");
  for (const l of LANG_CODES.filter((x) => x !== "en"))
    assert.match(r, new RegExp(`^/  /${l}/  302!  Language=${l}$`, "m"));
  assert.match(r, /^\/  \/en\/  302!$/m);
  assert.match(r, /^\/projects\/\*  \/en\/projects\/:splat  301$/m);
  assert.ok(r.indexOf("Language=") < r.indexOf("/  /en/  302!"), "language rules come first");
});

test("contact form is a working Netlify form with spam protection", () => {
  for (const l of LANG_CODES) {
    const h = pages[`/${l}/index.html`];
    const form = /<form\b[^>]*>/.exec(h)[0];
    assert.match(form, /name="contact"/);
    assert.match(form, /data-netlify="true"/);
    assert.match(form, /netlify-honeypot="bot-field"/);
    assert.match(form, new RegExp(`action="/${l}/thanks/"`));
    assert.match(h, /<input type="hidden" name="form-name" value="contact"\s*\/?>/);
    for (const n of ["name", "email", "message"])
      assert.match(h, new RegExp(`<label[^>]*for="cf-${n}"`), `${l}: label ${n}`);
  }
  assert.match(pages["/en/thanks/index.html"], /<meta name="robots" content="noindex"/);
});

test("each page has one h1, a title, a description, a language and no skipped heading levels", () => {
  for (const [f, h] of Object.entries(pages)) {
    assert.equal((h.match(/<h1[\s>]/g) || []).length, 1, `${f}: exactly one h1`);
    assert.match(h, /<html lang="[a-z]{2}" dir="(ltr|rtl)">/, f);
    assert.match(h, /<title>[^<]{5,}<\/title>/, f);
    assert.match(h, /<meta name="description" content="[^"]{20,}"\s*\/?>/, f);
    const levels = [...h.matchAll(/<h([1-6])[\s>]/g)].map((m) => Number(m[1]));
    levels.forEach((l, i) => i && assert.ok(l <= levels[i - 1] + 1, `${f}: h${levels[i - 1]} followed by h${l}`));
  }
});

test("ids are unique within each page", () => {
  for (const [f, h] of Object.entries(pages)) {
    const ids = [...h.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]);
    assert.equal(new Set(ids).size, ids.length, `${f}: duplicate id ${ids.find((x, i) => ids.indexOf(x) !== i)}`);
  }
});

test("images have alt text and dimensions; the files exist", () => {
  for (const [f, h] of Object.entries(pages)) {
    for (const [tag] of h.matchAll(/<img\b[^>]*>/g)) {
      assert.match(tag, /\salt="[^"]{10,}"/, `${f}: ${tag}`);
      assert.match(tag, /\swidth="\d+" height="\d+"|\sheight="\d+"/, `${f}: ${tag}`);
      const src = /src="([^"]+)"/.exec(tag)[1];
      assert.ok(existsSync(path.join(OUT, src)), `${f}: missing ${src}`);
    }
  }
});

test("internal links and assets resolve", () => {
  for (const [f, h] of Object.entries(pages)) {
    for (const [, href] of h.matchAll(/\s(?:href|src|srcset)="(\/[^"#?]*)/g)) {
      const target = path.join(OUT, href);
      const ok = existsSync(target) && (!href.endsWith("/") || existsSync(path.join(target, "index.html")));
      assert.ok(ok, `${f}: broken link ${href}`);
    }
  }
});

test("external links open safely and use https", () => {
  for (const [f, h] of Object.entries(pages)) {
    for (const [tag] of h.matchAll(/<a\b[^>]*href="http[^"]*"[^>]*>/g)) {
      if (/fonts\.googleapis/.test(tag)) continue;
      assert.match(tag, /href="https:/, `${f}: ${tag}`);
      assert.match(tag, /rel="noopener"/, `${f}: ${tag}`);
    }
  }
});

test("CSP: no inline styles or handlers; the only inline script is allowed by hash", () => {
  for (const [f, h] of Object.entries(pages)) {
    assert.doesNotMatch(h, /\sstyle="/, `${f}: inline style attribute`);
    assert.doesNotMatch(h, /\son[a-z]+="/, `${f}: inline event handler`);
    const inline = [...h.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
    for (const s of inline) {
      const hash = createHash("sha256").update(s).digest("base64");
      assert.ok(result.csp.includes(`'sha256-${hash}'`), `${f}: inline script not in CSP`);
    }
  }
});

test("SEO files: sitemap lists every indexable page, canonical and og tags are absolute", () => {
  const sitemap = readFileSync(path.join(OUT, "sitemap.xml"), "utf8");
  const indexable = Object.entries(pages).filter(
    ([f, h]) => f !== "/index.html" && !/name="robots" content="noindex"/.test(h),
  );
  assert.equal((sitemap.match(/<loc>/g) || []).length, indexable.length, "every indexable page");
  assert.doesNotMatch(sitemap, /404|thanks/);
  assert.match(pages["/it/index.html"], /<link rel="canonical" href="https:\/\/portfolio\.example\/it\/"\s*\/?>/);
  assert.match(
    pages["/en/index.html"],
    /<meta property="og:image" content="https:\/\/portfolio\.example\/og\.png"\s*\/?>/,
  );
  assert.ok(existsSync(path.join(OUT, "og.png")), "og image exists");
  JSON.parse(/<script type="application\/ld\+json">(.*?)<\/script>/s.exec(pages["/en/index.html"])[1]);
});

test("no secrets, private files or placeholders are published", () => {
  // The original Italian CV includes a home address; only the CVs generated from the site may ship.
  assert.deepEqual(
    walk(OUT)
      .filter((f) => f.endsWith(".pdf"))
      .map((f) => path.basename(f))
      .sort(),
    LANG_CODES.map((l) => `cv-ahmad-kassar-${l}.pdf`).sort(),
  );
  for (const f of walk(OUT)) {
    assert.ok(!f.includes("private"), `private file published: ${f}`);
    if (!/\.(html|js|css|txt|xml|svg)$/.test(f) && !f.endsWith("_headers")) continue;
    const t = readFileSync(f, "utf8");
    assert.doesNotMatch(t, /(sk-[A-Za-z0-9]{20,}|BEGIN [A-Z ]*PRIVATE KEY|eyJhbGciOi)/, `${f}: looks like a secret`);
    assert.doesNotMatch(t, /\b(TODO|FIXME|lorem ipsum)\b/i, `${f}: placeholder text`);
  }
});

// Phrases describing unfixed findings in client systems live in docs/private/
// (git-ignored). When that file is present, the build must not contain them.
const PHRASES = path.join(REPO, "docs/private/forbidden-phrases.txt");
test(
  "public pages don't disclose unfixed security findings in client systems",
  { skip: !existsSync(PHRASES) && "no private phrase list" },
  () => {
    const all = Object.values(pages).join("\n").toLowerCase();
    for (const phrase of readFileSync(PHRASES, "utf8")
      .split("\n")
      .map((l) => l.trim().toLowerCase())
      .filter(Boolean)) {
      assert.ok(!all.includes(phrase), "a private finding appears on a public page");
    }
  },
);

test("test counts claimed on the site match the test files", () => {
  const count = (dir, re) =>
    walk(path.join(REPO, dir))
      .filter((f) => re.test(f))
      .reduce((n, f) => n + (readFileSync(f, "utf8").match(/^\s*(test|def test_)\w*\(/gm) || []).length, 0);
  const html =
    pages["/en/projects/slotbook/index.html"] +
    pages["/en/projects/hostwatch/index.html"] +
    pages["/en/projects/shipyard/index.html"];
  const claims = {
    "12 unit tests": count("projects/slotbook/tests/unit", /\.test\.js$/),
    "23 integration tests": count("projects/slotbook/tests/integration", /\.test\.js$/),
    "2 browser tests": count("projects/slotbook/tests/e2e", /\.test\.js$/),
    "16 Node tests": count("projects/hostwatch/server/tests", /\.test\.js$/),
    "11 Python tests": count("projects/hostwatch/agent/tests", /\.py$/),
  };
  for (const [claim, actual] of Object.entries(claims)) {
    assert.ok(html.includes(claim), `site doesn't mention "${claim}"`);
    assert.equal(Number(claim.split(" ")[0]), actual, `"${claim}" but the code has ${actual}`);
  }
  const shipyard =
    readFileSync(path.join(REPO, "projects/shipyard/tests/test_scripts.sh"), "utf8").match(
      /^\s*(deploy|rollback|"\$ROOT[^"]*"|f=|export|:|exec)?.*\bcheck "/gm,
    ) || [];
  assert.equal(shipyard.length, 19, "Shipyard script checks");
  assert.ok(html.includes("19 script tests"));
});

test("every project states its evidence", () => {
  for (const p of projects.filter((x) => x.slug)) {
    assert.ok(p.ledger.length >= 2, `${p.slug} needs an evidence ledger`);
    assert.ok(p.limitations.length, `${p.slug} needs limitations`);
  }
});

test("canonical domain: SITE_URL wins, Netlify's URL is the fallback, http is refused", () => {
  assert.equal(siteConfig({ SITE_URL: "https://a.example/", URL: "https://b.example" }).url, "https://a.example");
  assert.equal(siteConfig({ URL: "https://b.netlify.app" }).url, "https://b.netlify.app");
  assert.equal(siteConfig({}).url, null);
  assert.throws(() => siteConfig({ SITE_URL: "http://a.example" }));
});

test("projects become open source only once the repository URL is configured", () => {
  const c = contentFor("en");
  const os = (x) =>
    x.projects
      .filter((p) => p.categories.includes("open-source"))
      .map((p) => p.slug)
      .sort();
  assert.deepEqual(os(withPublishedSource(c, { repoUrl: null })), []);
  assert.deepEqual(os(withPublishedSource(c, { repoUrl: "https://github.com/x/y" })), [
    "hostwatch",
    "shipyard",
    "slotbook",
  ]);
});
