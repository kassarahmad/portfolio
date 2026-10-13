// Static site build: renders every page in every language to dist/. No dependencies.
//   SITE_URL=https://example.com  enables canonical URLs, hreflang, og:url/og:image and sitemap.xml
//   (falls back to Netlify's URL variable during Netlify builds)
//   REPO_URL=https://github.com/<user>/<repo>  turns "source in this repository" into links
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { layout, themeBootScript } from "../src/templates/layout.mjs";
import {
  casePage,
  cvPage,
  homePage,
  languageChooser,
  notFoundPage,
  projectsPage,
  simplePage,
  link,
} from "../src/templates/pages.mjs";
import * as base from "../src/content/profile.mjs";
import { buongusto, hyperlean, prontix, stepvia } from "../src/content/existing-projects.mjs";
import { hostwatch, shipyard, slotbook } from "../src/content/new-projects.mjs";
import { DEFAULT_LANG, LANGS, UI } from "../src/i18n/ui.mjs";
import { localize } from "../src/i18n/localize.mjs";
import it from "../src/i18n/it.mjs";
import fr from "../src/i18n/fr.mjs";
import ar from "../src/i18n/ar.mjs";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, "dist");

export const projects = [hyperlean, buongusto, slotbook, hostwatch, prontix, shipyard, stepvia];
const TRANSLATIONS = { it, fr, ar };

/** The English base content as one tree, in the same shape as a translation file. */
export function baseContent() {
  return {
    profile: base.profile,
    skillGroups: base.skillGroups,
    experience: base.experience,
    education: base.education,
    certifications: base.certifications,
    projects: Object.fromEntries(projects.map((p) => [p.slug, p])),
  };
}

/** Content for one language; throws if any translatable string is missing. */
export function contentFor(lang) {
  const b = baseContent();
  const c = lang === DEFAULT_LANG ? b : localize(b, TRANSLATIONS[lang], lang);
  return { ...c, projects: projects.map((p) => c.projects[p.slug]) };
}

/** Once the repository is public (REPO_URL), projects whose code is in it count as open source. */
export function withPublishedSource(c, site) {
  if (!site.repoUrl) return c;
  const projects = c.projects.map((p) =>
    p.repoPath && !p.categories.includes("open-source") ? { ...p, categories: [...p.categories, "open-source"] } : p,
  );
  return { ...c, projects };
}

export function siteConfig(env = process.env) {
  // SITE_URL wins; on Netlify builds, URL is the site's primary address, so canonical
  // links follow the site even if SITE_URL was never set.
  const raw = env.SITE_URL || env.URL || "";
  const url = raw ? raw.replace(/\/$/, "") : null;
  if (url && !/^https:\/\//.test(url)) throw new Error("SITE_URL must start with https://");
  return {
    name: base.profile.name,
    location: base.profile.location,
    email: base.profile.email,
    github: base.profile.github,
    url,
    repoUrl: env.REPO_URL || null,
  };
}

function personJsonLd(site, c, lang) {
  return {
    "@context": "https://schema.org",
    "@type": "Person",
    name: c.profile.name,
    jobTitle: UI[lang].meta.homeTitle,
    description: c.profile.role,
    email: `mailto:${c.profile.email}`,
    address: { "@type": "PostalAddress", addressLocality: "Ancona", addressCountry: "IT" },
    alumniOf: { "@type": "CollegeOrUniversity", name: "Università degli Studi di Camerino" },
    knowsLanguage: ["ar", "it", "en", "fr"],
    sameAs: [c.profile.github],
    ...(site.url ? { url: `${site.url}/${lang}/` } : {}),
  };
}

export async function build({ env = process.env, out = OUT } = {}) {
  const site = siteConfig(env);
  const css = await readFile(path.join(ROOT, "src/assets/site.css"), "utf8");
  const js = await readFile(path.join(ROOT, "src/assets/site.js"), "utf8");
  site.version = createHash("sha256")
    .update(css + js)
    .digest("hex")
    .slice(0, 10);

  await rm(out, { recursive: true, force: true });
  await mkdir(path.join(out, "assets"), { recursive: true });
  await cp(path.join(ROOT, "public"), out, { recursive: true });
  await writeFile(path.join(out, "assets/site.css"), css);
  await writeFile(path.join(out, "assets/site.js"), js);

  const pages = [];
  const contents = Object.fromEntries(Object.keys(LANGS).map((l) => [l, withPublishedSource(contentFor(l), site)]));
  for (const lang of Object.keys(LANGS)) {
    const c = contents[lang];
    const t = { ...UI[lang], footerLocation: c.profile.location };
    const ctx = { site, t, lang, ...c };
    const withSlug = c.projects.filter((p) => p.slug);
    pages.push(
      {
        lang,
        t,
        path: "/",
        title: null,
        description: t.meta.homeDesc,
        jsonLd: personJsonLd(site, c, lang),
        body: homePage(ctx),
      },
      {
        lang,
        t,
        path: "/projects/",
        title: t.projects.title,
        description: t.meta.projectsDesc,
        body: projectsPage(ctx),
      },
      { lang, t, path: "/cv/", title: t.nav.cv, description: t.meta.cvDesc, body: cvPage(ctx) },
      {
        lang,
        t,
        path: "/privacy/",
        title: t.privacy.title,
        description: t.meta.privacyDesc,
        body: simplePage({ title: t.privacy.title, paragraphs: t.privacy.body }),
      },
      {
        lang,
        t,
        path: "/thanks/",
        title: t.contact.thanksTitle,
        description: t.meta.thanksDesc,
        noindex: true,
        alternates: false,
        body: simplePage({
          title: t.contact.thanksTitle,
          paragraphs: [t.contact.thanksText],
          action: { href: link(lang, "/"), label: t.contact.back },
        }),
      },
      {
        lang,
        t,
        path: "/404.html",
        file: `${lang}/404.html`,
        title: t.notFound.title,
        description: t.meta.notFoundDesc,
        noindex: true,
        alternates: false,
        body: notFoundPage({ t, lang }),
      },
      ...withSlug.map((p, i) => ({
        lang,
        t,
        path: `/projects/${p.slug}/`,
        title: p.title,
        description: p.summary,
        ogType: "article",
        body: casePage({ ...ctx, p, prev: withSlug[i - 1], next: withSlug[i + 1] }),
      })),
    );
  }
  // Language-neutral entry page. Netlify sends "/" to the visitor's language; this is the fallback.
  pages.push({
    lang: null,
    t: UI.en,
    path: "/",
    file: "index.html",
    title: null,
    description: UI.en.meta.homeDesc,
    alternates: false,
    body: languageChooser({ langs: LANGS }),
  });

  for (const page of pages) {
    const file = path.join(out, page.file ?? `${page.lang}${page.path}index.html`);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, String(layout({ site, t: page.t, lang: page.lang, page, body: page.body })));
  }

  // Security headers (Netlify format). The one inline script is allowed by hash only.
  const bootHash = createHash("sha256").update(themeBootScript).digest("base64");
  const csp = [
    "default-src 'self'",
    `script-src 'self' 'sha256-${bootHash}'`,
    "style-src 'self'",
    "img-src 'self' data:",
    "font-src 'self'",
    "connect-src 'self'",
    "frame-ancestors 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    "object-src 'none'",
  ].join("; ");
  await writeFile(
    path.join(out, "_headers"),
    `/*\n  Content-Security-Policy: ${csp}\n  X-Content-Type-Options: nosniff\n  Referrer-Policy: strict-origin-when-cross-origin\n  Permissions-Policy: camera=(), microphone=(), geolocation=()\n  Strict-Transport-Security: max-age=31536000\n\n/assets/*\n  Cache-Control: public, max-age=31536000, immutable\n/img/*\n  Cache-Control: public, max-age=604800\n`,
  );

  // "/" goes to the visitor's language; the nf_lang cookie set by the language
  // switcher overrides the browser setting. Old English URLs keep working.
  const others = Object.keys(LANGS).filter((l) => l !== DEFAULT_LANG);
  await writeFile(
    path.join(out, "_redirects"),
    [
      ...others.map((l) => `/  /${l}/  302!  Language=${l}`),
      `/  /${DEFAULT_LANG}/  302!`,
      `/projects/*  /${DEFAULT_LANG}/projects/:splat  301`,
      `/cv/  /${DEFAULT_LANG}/cv/  301`,
      `/cv-ahmad-kassar.pdf  /cv-ahmad-kassar-${DEFAULT_LANG}.pdf  301`,
      ...Object.keys(LANGS).map((l) => `/${l}/*  /${l}/404.html  404`),
      `/*  /${DEFAULT_LANG}/404.html  404`,
      "",
    ].join("\n"),
  );

  const indexable = pages.filter((p) => p.lang && !p.noindex);
  if (site.url) {
    const today = new Date().toISOString().slice(0, 10);
    const entries = indexable.map((p) => {
      const alts = Object.keys(LANGS)
        .map((l) => `<xhtml:link rel="alternate" hreflang="${l}" href="${site.url}/${l}${p.path}"/>`)
        .join("");
      return `  <url><loc>${site.url}/${p.lang}${p.path}</loc><lastmod>${today}</lastmod>${alts}</url>`;
    });
    await writeFile(
      path.join(out, "sitemap.xml"),
      `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n${entries.join("\n")}\n</urlset>\n`,
    );
    await writeFile(path.join(out, "robots.txt"), `User-agent: *\nAllow: /\nSitemap: ${site.url}/sitemap.xml\n`);
  } else {
    await writeFile(path.join(out, "robots.txt"), "User-agent: *\nAllow: /\n");
  }
  return { pages: pages.map((p) => (p.lang ? `/${p.lang}${p.path}` : p.path)), site, csp };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const r = await build();
  process.stdout.write(
    `Built ${r.pages.length} pages into dist/${r.site.url ? ` for ${r.site.url}` : " (no SITE_URL: canonical links and sitemap skipped)"}\n`,
  );
}
