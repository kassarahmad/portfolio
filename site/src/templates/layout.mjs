import { html, raw } from "./html.mjs";
import { LANGS } from "../i18n/ui.mjs";

// Runs before first paint so a saved theme never flashes the wrong colours.
const THEME_BOOT = `try{var t=localStorage.getItem("theme");if(t==="light"||t==="dark")document.documentElement.setAttribute("data-theme",t)}catch(e){}`;
export const themeBootScript = THEME_BOOT;

/**
 * page: { path (without language prefix, e.g. "/projects/"), title, description, ogType, jsonLd, noindex, alternates }
 * lang: language code, or null for the language-neutral root page.
 */
export function layout({ site, t, lang, page, body }) {
  const meta = lang ? LANGS[lang] : LANGS.en;
  const title = page.title ? `${page.title} · ${site.name}` : `${site.name} · ${t.meta.homeTitle}`;
  const href = (code, p = page.path) => `/${code}${p}`;
  const abs = (p) => (site.url ? site.url + p : null);
  const canonical = lang ? abs(href(lang)) : abs("/");
  const ogImage = abs("/og.png");
  const nav = lang
    ? [
        [href(lang, "/"), t.nav.home, page.path === "/"],
        [href(lang, "/projects/"), t.nav.projects, page.path.startsWith("/projects/")],
        [href(lang, "/cv/"), t.nav.cv, page.path === "/cv/"],
        [href(lang, "/#contact"), t.nav.contact, false],
      ]
    : [];
  const alternates = page.alternates === false ? [] : Object.keys(LANGS);

  return html`<!doctype html>
    <html lang="${meta.htmlLang}" dir="${meta.dir}">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>${title}</title>
        <meta name="description" content="${page.description}" />
        <meta name="author" content="${site.name}" />
        ${page.noindex ? html`<meta name="robots" content="noindex" />` : ""}
        <meta name="theme-color" content="#f3f5f7" media="(prefers-color-scheme: light)" />
        <meta name="theme-color" content="#0f1720" media="(prefers-color-scheme: dark)" />
        ${canonical && !page.noindex ? html`<link rel="canonical" href="${canonical}" />` : ""}
        ${
          site.url && lang && !page.noindex
            ? html`${alternates.map((c) => html`<link rel="alternate" hreflang="${c}" href="${abs(href(c))}" />`)}<link rel="alternate" hreflang="x-default" href="${abs(href("en"))}" />`
            : ""
        }
        <meta property="og:type" content="${page.ogType || "website"}" />
        <meta property="og:title" content="${page.title || site.name}" />
        <meta property="og:description" content="${page.description}" />
        <meta property="og:site_name" content="${site.name}" />
        <meta property="og:locale" content="${meta.locale}" />
        ${canonical ? html`<meta property="og:url" content="${canonical}" />` : ""}
        ${
          ogImage
            ? html`<meta property="og:image" content="${ogImage}" /><meta property="og:image:width" content="1200" /><meta property="og:image:height" content="630" /><meta name="twitter:card" content="summary_large_image" />`
            : ""
        }
        <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
        <link rel="stylesheet" href="/assets/site.css?v=${site.version}" />
        <script>${raw(THEME_BOOT)}</script>
        <script src="/assets/site.js?v=${site.version}" defer></script>
        ${page.jsonLd ? html`<script type="application/ld+json">${raw(JSON.stringify(page.jsonLd).replaceAll("<", "\\u003c"))}</script>` : ""}
      </head>
      <body>
        <a class="skip" href="#main">${t.skip}</a>
        <header class="site-header">
          <div class="wrap">
            <a class="brand" href="${lang ? href(lang, "/") : "/"}">${site.name}</a>
            ${
              lang
                ? html`<nav class="nav" id="site-nav" aria-label="${t.nav.main}">
                  <ul>
                    ${nav.map(([h, label, cur]) => html`<li><a href="${h}" ${cur ? raw('aria-current="page"') : ""}>${label}</a></li>`)}
                  </ul>
                  ${
                    alternates.length
                      ? html`<ul class="langs" aria-label="${t.nav.language}">
                        ${alternates.map(
                          (c) =>
                            html`<li><a href="${href(c)}" hreflang="${c}" lang="${c}" data-lang="${c}" ${c === lang ? raw('aria-current="true"') : ""}>${c.toUpperCase()}<span class="sr-only"> ${LANGS[c].name}</span></a></li>`,
                        )}
                      </ul>`
                      : ""
                  }
                </nav>`
                : ""
            }
            <button
              class="icon-btn"
              type="button"
              data-theme-toggle
              data-label="${t.theme.label}"
              data-change="${t.theme.change}"
              data-system="${t.theme.system}"
              data-light="${t.theme.light}"
              data-dark="${t.theme.dark}"
              aria-label="${t.theme.label}: ${t.theme.system}. ${t.theme.change}"
            >
              ${t.theme.system}
            </button>
            ${
              lang
                ? html`<button class="icon-btn menu-btn" type="button" data-menu-toggle aria-controls="site-nav" aria-expanded="false">${t.nav.menu}</button>`
                : ""
            }
          </div>
        </header>
        <main id="main" tabindex="-1">${body}</main>
        <footer class="site-footer">
          <div class="wrap">
            <p>${site.name} · ${t.footerLocation ?? site.location}</p>
            <p>
              <a href="mailto:${site.email}" dir="ltr">${site.email}</a> · <a href="${site.github}" rel="noopener">GitHub</a>
              ${lang ? html` · <a href="${href(lang, "/privacy/")}">${t.footer.privacy}</a>` : ""} · ${t.footer.built}
            </p>
          </div>
        </footer>
      </body>
    </html>`;
}
