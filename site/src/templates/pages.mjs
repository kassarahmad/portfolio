import { html, inline, raw } from "./html.mjs";
import { diagram } from "./diagram.mjs";

export const CATEGORY_KEYS = ["full-stack", "backend", "frontend", "cloud", "ai", "open-source"];
const EVIDENCE_CLASS = {
  source: "ev",
  database: "ev",
  built: "ev built",
  thesis: "ev",
  live: "ev partial",
  partial: "ev partial",
  cv: "ev cv",
  unknown: "ev cv",
};
const SKILL_CLASS = { work: "ev", project: "ev built", cv: "ev cv" };

// Links inside a language: /<lang>/path/
export const link = (lang, p = "/") => `/${lang}${p}`;

const ev = (t, level) =>
  html`<span class="${EVIDENCE_CLASS[level] ?? "ev cv"}">${t.evidence[level] ?? t.evidence.unknown}</span>`;
const skillEv = (t, level) => html`<span class="${SKILL_CLASS[level]}">${t.skillLevel[level]}</span>`;

const section = (id, title, note, content) =>
  html` <section class="section" id="${id}" aria-labelledby="${id}-h">
    <div class="wrap section-grid">
      <div>
        <h2 id="${id}-h">${title}</h2>
        ${note ? html`<p class="note">${note}</p>` : ""}
      </div>
      <div>${content}</div>
    </div>
  </section>`;

function sourceLine(p, site, t) {
  if (!p.repoPath) return "";
  return site.repoUrl
    ? html`<a href="${site.repoUrl}/tree/main/${p.repoPath}" rel="noopener">${t.row.github}</a>`
    : html`<span>${t.row.repo(p.repoPath)}</span>`;
}

/** List separator: Arabic uses its own comma. */
const sep = (lang) => (lang === "ar" ? "، " : ", ");

export function projectRow(p, { site, t, lang }, { headingLevel = 3 } = {}) {
  const href = p.slug ? link(lang, `/projects/${p.slug}/`) : null;
  const titleInner = href ? html`<a href="${href}">${p.title}</a>` : p.title;
  const heading = headingLevel === 2 ? html`<h2>${titleInner}</h2>` : html`<h3>${titleInner}</h3>`;
  return html` <li class="project-row" data-categories="${p.categories.join(" ")}">
    <div>
      ${heading}
      <p>${p.summary}</p>
      <ul class="tags" aria-label="${t.row.tech}">
        ${p.stack.slice(0, 7).map((s) => html`<li dir="ltr">${s}</li>`)}
      </ul>
    </div>
    <div class="project-side">
      <dl>
        <dt>${t.row.status}</dt>
        <dd><span class="status ${p.repoPath ? "built" : ""}">${p.status}</span></dd>
        ${p.org ? html`<dt>${t.row.company}</dt><dd><bdi dir="ltr">${p.org}</bdi></dd>` : ""}
        <dt>${t.row.year}</dt>
        <dd><bdi dir="ltr">${p.period}</bdi></dd>
        <dt>${t.row.area}</dt>
        <dd>${p.categories.map((c) => t.categories[c]).join(sep(lang))}</dd>
        ${
          p.links?.length
            ? html`<dt>${t.row.live}</dt>
              <dd>${p.links.map((l) => html`<a href="${l.url}" rel="noopener" dir="ltr">${new URL(l.url).host}</a>`)}</dd>`
            : ""
        }
        ${p.repoPath ? html`<dt>${t.row.code}</dt><dd>${sourceLine(p, site, t)}</dd>` : ""}
      </dl>
    </div>
  </li>`;
}

// ---------------------------------------------------------------- home ---
function contactForm(t, lang) {
  return html`<form class="contact-form" name="contact" method="POST" action="${link(lang, "/thanks/")}" data-netlify="true" netlify-honeypot="bot-field">
    <input type="hidden" name="form-name" value="contact" />
    <input type="hidden" name="language" value="${lang}" />
    <p class="hp" aria-hidden="true"><label>${t.contact.honeypot} <input name="bot-field" tabindex="-1" autocomplete="off" /></label></p>
    <h3>${t.contact.formTitle}</h3>
    <div class="field-row">
      <div class="field"><label for="cf-name">${t.contact.name}</label><input id="cf-name" name="name" required maxlength="100" autocomplete="name" /></div>
      <div class="field"><label for="cf-email">${t.contact.email}</label><input id="cf-email" name="email" type="email" required maxlength="200" autocomplete="email" dir="ltr" /></div>
    </div>
    <div class="field"><label for="cf-company">${t.contact.company}</label><input id="cf-company" name="company" maxlength="120" autocomplete="organization" /></div>
    <div class="field"><label for="cf-message">${t.contact.message}</label><textarea id="cf-message" name="message" required minlength="10" maxlength="4000" rows="6"></textarea></div>
    <p class="legend-line">${t.contact.consent} <a href="${link(lang, "/privacy/")}">${t.contact.privacyLink}</a></p>
    <button class="btn primary" type="submit">${t.contact.send}</button>
  </form>`;
}

export function homePage(ctx) {
  const { t, lang, profile, skillGroups, experience, education, certifications, projects } = ctx;
  const featured = projects.filter((p) => p.featured);
  return html`
    <section class="hero">
      <div class="wrap hero-grid">
        <div>
          <p class="availability"><span class="dot" aria-hidden="true"></span>${profile.availability}</p>
          <h1>${profile.headline}</h1>
          <p class="role">${profile.role}</p>
          <p class="lede">${profile.lede}</p>
          <div class="actions">
            <a class="btn primary" href="${link(lang, "/projects/")}">${t.home.seeProjects}</a>
            <a class="btn" href="${link(lang, "/cv/")}">${t.nav.cv}</a>
            <a class="btn" href="#contact">${t.home.emailMe}</a>
          </div>
        </div>
        <div>
          <picture>
            <source srcset="/ahmad-kassar.webp" type="image/webp" />
            <img class="portrait" src="/ahmad-kassar.jpg" width="224" height="249" fetchpriority="high" decoding="async" alt="${t.home.portraitAlt}" />
          </picture>
          <div class="hero-meta">
            <ul>
              <li>${profile.location}</li>
              <li>${t.home.degree}</li>
              <li>${t.home.spoken}</li>
            </ul>
          </div>
        </div>
      </div>
    </section>

    ${section(
      "work",
      t.home.selectedWork,
      t.home.selectedWorkNote,
      html` <ul class="project-list">
          ${featured.map((p) => projectRow(p, ctx))}
        </ul>
        <p class="more"><a href="${link(lang, "/projects/")}">${t.home.allProjects(projects.length)}</a></p>`,
    )}
    ${section("about", t.home.about, null, html`<div class="prose">${profile.about.map((p) => html`<p>${p}</p>`)}</div>`)}
    ${section(
      "skills",
      t.home.skills,
      t.home.skillsNote,
      html` <ul class="evidence-key" aria-label="Key">
          ${["work", "project", "cv"].map((k) => html`<li>${skillEv(t, k)}</li>`)}
        </ul>
        <div class="skills">
          ${skillGroups.map(
            (g) => html` <div>
              <h3>${g.title}</h3>
              <table class="skill-table">
                <tbody>
                  ${g.items.map(
                    ([name, level, where]) => html`<tr>
                      <th scope="row">${name}</th>
                      <td>${skillEv(t, level)}<br />${where}</td>
                    </tr>`,
                  )}
                </tbody>
              </table>
            </div>`,
          )}
        </div>`,
    )}
    ${section(
      "experience",
      t.home.experience,
      null,
      html` <ol class="timeline" reversed>
        ${experience.map(
          (e) => html` <li>
            <span class="when">${e.when}</span>
            <div>
              <h3>${e.title}</h3>
              <p class="org">${e.org} ${e.evidence === "cv" || e.evidence === "thesis" ? html` · ${ev(t, e.evidence)}` : ""}</p>
              <ul>
                ${e.points.map((p) => html`<li>${p}</li>`)}
              </ul>
            </div>
          </li>`,
        )}
      </ol>`,
    )}
    ${section(
      "education",
      t.home.education,
      null,
      html` <ol class="timeline" reversed>
          ${education.map(
            (e) => html`<li>
              <span class="when">${e.when}</span>
              <div>
                <h3>${e.title}</h3>
                <p class="org">${e.org}</p>
                ${e.note ? html`<p class="edu-note">${e.note}</p>` : ""}
              </div>
            </li>`,
          )}
        </ol>
        <h3 class="sub-h">${t.home.certificates}</h3>
        <ul class="prose">
          ${certifications.map((c) => html`<li>${c.title}, ${c.org}</li>`)}
        </ul>`,
    )}
    ${section(
      "contact",
      t.home.contact,
      null,
      html` <p class="prose">${t.home.contactIntro}</p>
        <div class="contact-grid">
          <ul class="contact-list">
            <li><span>${t.home.labels.email}</span><a href="mailto:${profile.email}" dir="ltr">${profile.email}</a></li>
            <li><span>${t.home.labels.phone}</span><a href="tel:${profile.phone.replaceAll(" ", "")}" dir="ltr">${profile.phone}</a></li>
            <li><span>${t.home.labels.github}</span><a href="${profile.github}" rel="noopener" dir="ltr">${profile.github.replace("https://", "")}</a></li>
            <li><span>${t.home.labels.based}</span>${profile.location}</li>
          </ul>
          ${contactForm(t, lang)}
        </div>`,
    )}
  `;
}

// ------------------------------------------------------------ projects ---
export function projectsPage(ctx) {
  const { t, projects } = ctx;
  const counts = Object.fromEntries(
    CATEGORY_KEYS.map((k) => [k, projects.filter((p) => p.categories.includes(k)).length]),
  );
  return html` <section class="case-head">
      <div class="wrap">
        <h1>${t.projects.title}</h1>
        <p class="summary">${t.projects.summary}</p>
      </div>
    </section>
    <section class="section">
      <div class="wrap">
        <fieldset class="filters" data-filters hidden>
          <legend>${t.projects.show}</legend>
          <button class="chip" type="button" data-filter="all" aria-pressed="true"><bdi>${t.projects.all}</bdi><span class="n">${projects.length}</span></button>
          ${CATEGORY_KEYS.map(
            (k) =>
              html`<button class="chip" type="button" data-filter="${k}" aria-pressed="false"><bdi>${t.categories[k]}</bdi><span class="n">${counts[k]}</span></button>`,
          )}
        </fieldset>
        <p class="result-count" data-count aria-live="polite" data-count-tpl="${t.projects.count("{n}")}" data-count-one="${t.projects.count(1)}">${t.projects.count(projects.length)}</p>
        <div
          class="empty"
          data-empty
          data-messages="${JSON.stringify(
            Object.fromEntries(
              CATEGORY_KEYS.map((k) => [
                k,
                k === "open-source" ? t.projects.emptyOpenSource : t.projects.empty(t.categories[k]),
              ]),
            ),
          )}"
          hidden
        >
          <p data-empty-text></p>
          <button class="btn" type="button" data-filter="all">${t.projects.showAll}</button>
        </div>
        <ul class="project-list">
          ${projects.map((p) => projectRow(p, ctx, { headingLevel: 2 }))}
        </ul>
      </div>
    </section>`;
}

// ---------------------------------------------------------- case study ---
export function casePage(ctx) {
  const { site, t, lang, p, prev, next } = ctx;
  const c = t.case;
  const parts = [];
  parts.push(
    section(
      "overview",
      c.overview,
      null,
      html` <div class="prose">
        <p>${p.problem}</p>
        <h3>${c.whoFor}</h3>
        <ul>
          ${p.users.map((u) => html`<li>${u}</li>`)}
        </ul>
        <h3>${c.whatDoes}</h3>
        <ul>
          ${p.features.map((f) => html`<li>${inline(f)}</li>`)}
        </ul>
      </div>`,
    ),
  );

  if (p.screenshots?.length) {
    parts.push(
      section(
        "screens",
        c.screens,
        null,
        html`<div class="shots">
          ${p.screenshots.map(
            (s) => html` <figure class="shot">
              <img src="${s.src}" width="${s.w}" height="${s.h}" alt="${s.alt}" loading="lazy" decoding="async" />
              <figcaption>${s.caption}</figcaption>
            </figure>`,
          )}
        </div>`,
      ),
    );
  }

  if (p.diagram) {
    parts.push(
      section(
        "architecture",
        c.architecture,
        null,
        html` <figure class="diagram">
          <div class="diagram-scroll" dir="ltr">${diagram(p.diagram)}</div>
          <figcaption>${p.diagram.caption}</figcaption>
        </figure>`,
      ),
    );
  }

  if (p.decisions?.length) {
    parts.push(
      section(
        "decisions",
        c.decisions,
        c.decisionsNote,
        html` <div class="decisions prose">
            ${p.decisions.map((d) => html`<div class="decision"><h3>${d.title}</h3><p>${inline(d.body)}</p></div>`)}
          </div>
          ${
            p.code
              ? html`<figure class="code-fig">
                <pre class="code" dir="ltr"><code>${p.code.text}</code></pre>
                <figcaption class="legend-line">${p.code.caption}</figcaption>
              </figure>`
              : ""
          }`,
      ),
    );
  }

  if (p.review) {
    const n = p.review.privateCount;
    parts.push(
      section(
        "review",
        c.review,
        c.reviewNote,
        html` <div class="prose">
          ${p.review.public.map((x) => html`<p class="finding">${inline(x)}</p>`)}${n ? html`<p>${c.privateFindings(n)}</p>` : ""}
        </div>`,
      ),
    );
  }

  parts.push(
    section(
      "quality",
      c.quality,
      null,
      html` <div class="prose">
        <h3>${c.testing}</h3>
        <p>${inline(p.testing)}</p>
        <h3>${c.deployment}</h3>
        <p>${inline(p.deployment)}</p>
      </div>`,
    ),
  );

  parts.push(
    section(
      "next",
      c.next,
      null,
      html` <div class="prose">
        <h3>${c.limitations}</h3>
        <ul>
          ${p.limitations.map((l) => html`<li>${inline(l)}</li>`)}
        </ul>
        <h3>${c.roadmap}</h3>
        <ul>
          ${p.roadmap.map((l) => html`<li>${inline(l)}</li>`)}
        </ul>
      </div>`,
    ),
  );

  const levels = [...new Set(p.ledger.map((l) => l[1]))];
  parts.push(
    section(
      "evidence",
      c.evidence,
      c.evidenceNote,
      html` <ul class="evidence-key" aria-label="Key">
          ${levels.map((k) => html`<li>${ev(t, k)}</li>`)}
        </ul>
        <div class="ledger-wrap">
          <table class="ledger">
            <thead>
              <tr>
                <th scope="col">${c.claim}</th>
                <th scope="col">${c.evidenceCol}</th>
                <th scope="col">${c.checked}</th>
              </tr>
            </thead>
            <tbody>
              ${p.ledger.map(([claim, level, how]) => html`<tr><td>${claim}</td><td>${ev(t, level)}</td><td>${how}</td></tr>`)}
            </tbody>
          </table>
        </div>
        <p class="legend-line more">${inline(p.contribution)}</p>`,
    ),
  );

  const pager = html`<nav class="pager wrap" aria-label="${t.nav.projects}">
    ${prev ? html`<a class="pager-prev" href="${link(lang, `/projects/${prev.slug}/`)}"><span>${c.prev}</span>${prev.title}</a>` : html`<span></span>`}
    ${next ? html`<a class="pager-next" href="${link(lang, `/projects/${next.slug}/`)}"><span>${c.next_}</span>${next.title}</a>` : ""}
  </nav>`;

  return html` <article>
    <header class="case-head">
      <div class="wrap">
        <nav class="crumbs" aria-label="Breadcrumb"><a href="${link(lang, "/projects/")}">${t.nav.projects}</a></nav>
        <h1>${p.title}</h1>
        <p class="summary">${p.summary}</p>
        <dl class="facts">
          <div><dt>${t.row.status}</dt><dd>${p.status}</dd></div>
          ${p.org ? html`<div><dt>${t.row.company}</dt><dd><bdi dir="ltr">${p.org}</bdi></dd></div>` : ""}
          <div><dt>${c.role}</dt><dd>${p.role}</dd></div>
          <div><dt>${c.stack}</dt><dd dir="ltr" class="stack-list">${p.stack.join(", ")}</dd></div>
          ${
            p.links?.length
              ? html`<div><dt>${t.row.live}</dt><dd>${p.links.map((l) => html`<a href="${l.url}" rel="noopener" dir="ltr">${new URL(l.url).host}</a>`)}</dd></div>`
              : ""
          }
          ${p.repoPath ? html`<div><dt>${t.row.code}</dt><dd>${sourceLine(p, site, t)}</dd></div>` : ""}
        </dl>
      </div>
    </header>
    ${parts} ${pager}
  </article>`;
}

// ------------------------------------------------------------------ cv ---
export function cvPage(ctx) {
  const { t, lang, profile, skillGroups, experience, education, certifications, projects } = ctx;
  const shown = projects.filter((p) => p.slug);
  return html`
    <section class="case-head">
      <div class="wrap">
        <h1>${profile.name}</h1>
        <p class="summary">${profile.role}</p>
        <p class="legend-line">
          ${profile.location} · <a href="mailto:${profile.email}" dir="ltr">${profile.email}</a> · <span dir="ltr">${profile.phone}</span> ·
          <a href="${profile.github}" rel="noopener" dir="ltr">${profile.github.replace("https://", "")}</a>
        </p>
        <div class="actions no-print">
          <a class="btn primary" href="/cv-ahmad-kassar-${lang}.pdf" download>${t.cv.download}</a>
        </div>
      </div>
    </section>
    ${section("cv-profile", t.cv.profile, null, html`<p class="prose">${profile.lede}</p>`)}
    ${section(
      "cv-exp",
      t.cv.experience,
      null,
      html`<ol class="timeline" reversed>
        ${experience.map(
          (e) => html` <li>
            <span class="when">${e.when}</span>
            <div>
              <h3>${e.title}</h3>
              <p class="org">${e.org}</p>
              <ul>
                ${e.points.map((p) => html`<li>${p}</li>`)}
              </ul>
            </div>
          </li>`,
        )}
      </ol>`,
    )}
    ${section(
      "cv-projects",
      t.cv.projects,
      null,
      html`<ul class="prose">
        ${shown.map((p) => html`<li><strong>${p.title}</strong>: ${p.summary}</li>`)}
      </ul>`,
    )}
    ${section(
      "cv-skills",
      t.cv.skills,
      null,
      html`<div class="prose">${skillGroups.map((g) => html`<p><strong>${g.title}:</strong> ${g.items.map((i) => i[0]).join(", ")}</p>`)}</div>`,
    )}
    ${section(
      "cv-edu",
      t.cv.education,
      null,
      html`<ul class="prose">
        ${education.map((e) => html`<li>${e.title}, ${e.org} (${e.when})${e.note ? html`. ${e.note}` : ""}</li>`)}
        ${certifications.map((c) => html`<li>${c.title}, ${c.org}</li>`)}
      </ul>`,
    )}
    ${section("cv-lang", t.cv.languages, null, html`<p class="prose">${profile.languages.map(([l, lvl]) => `${l} (${lvl})`).join(sep(lang))}</p>`)}
  `;
}

export function simplePage({ title, paragraphs, action }) {
  return html` <section class="case-head">
      <div class="wrap">
        <h1>${title}</h1>
      </div>
    </section>
    <section class="section">
      <div class="wrap prose">
        ${paragraphs.map((p) => html`<p>${p}</p>`)} ${action ? html`<p><a class="btn primary" href="${action.href}">${action.label}</a></p>` : ""}
      </div>
    </section>`;
}

export function notFoundPage({ t, lang }) {
  return simplePage({
    title: t.notFound.title,
    paragraphs: [t.notFound.text],
    action: { href: link(lang, "/projects/"), label: t.notFound.link },
  });
}

export function languageChooser({ langs }) {
  return html` <section class="case-head chooser">
    <div class="wrap">
      <h1>Ahmad Kassar</h1>
      <ul class="lang-list">
        ${Object.entries(langs).map(
          ([code, l]) =>
            html`<li><a href="/${code}/" hreflang="${code}" lang="${code}" dir="${l.dir}" data-lang="${code}">${l.name}</a></li>`,
        )}
      </ul>
    </div>
  </section>`;
}

export { raw };
