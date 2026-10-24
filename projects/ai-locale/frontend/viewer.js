// Visualizzatore degli artefatti: documenti, codice, pagine HTML, dati, immagini, PDF, archivi.
import { esc, renderMarkdown } from "./markdown.js";

export const KIND_ICON = {
  document: "i-doc", code: "i-code", html: "i-globe", data: "i-table", image: "i-image",
  pdf: "i-doc", slides: "i-slides", archive: "i-archive", other: "i-file",
};
export const icon = (id, cls = "") => `<svg class="ic ${cls}"><use href="#${id}"/></svg>`;
export const kindIcon = (kind, cls = "") => icon(KIND_ICON[kind] || "i-file", cls);

export const fmtBytes = (n) => {
  if (n == null) return "–";
  const u = ["B", "KB", "MB", "GB", "TB"]; let i = 0; let v = n;
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(v < 10 && i ? 1 : 0)} ${u[i]}`;
};

// ---------------------------------------------------------------------------
// Evidenziazione del codice: piccola, senza dipendenze, sufficiente per leggere
// ---------------------------------------------------------------------------
const KW = {
  python: "and as assert async await break class continue def del elif else except False finally for from global if import in is lambda None nonlocal not or pass raise return True try while with yield self match case",
  javascript: "async await break case catch class const continue default delete do else export extends false finally for from function if import in instanceof let new null of return static super switch this throw true try typeof undefined var void while yield",
  typescript: "async await break case catch class const continue default delete do else enum export extends false finally for from function if implements import in instanceof interface let new null of private protected public readonly return static super switch this throw true try type typeof undefined var void while",
  java: "abstract boolean break byte case catch char class const continue default do double else enum extends final finally float for if implements import instanceof int interface long new null package private protected public return short static super switch this throw throws true false try void while val var fun",
  c: "auto break case char const continue default do double else enum extern float for if int long return short signed sizeof static struct switch typedef union unsigned void while class public private namespace using new delete true false null",
  go: "break case chan const continue default defer else fallthrough for func go goto if import interface map package range return select struct switch type var true false nil",
  rust: "as break const continue crate else enum extern false fn for if impl in let loop match mod move mut pub ref return self Self static struct super trait true type unsafe use where while async await",
  sql: "select from where insert into values update set delete create table primary key foreign references not null unique index join left right inner outer on group by order having limit offset as and or in is distinct count sum avg min max default alter drop serial integer text varchar boolean timestamp",
  shell: "if then else elif fi for in do done while case esac function return export local echo exit",
  powershell: "function param if else elseif foreach for while return try catch finally throw switch begin process end write-host get-childitem set-location new-item remove-item",
  css: "", html: "", json: "true false null", yaml: "true false null", toml: "true false",
  php: "function class public private protected return if else foreach as echo new array null true false",
  ruby: "def end class module if elsif else unless while do return true false nil self require",
};
KW.markdown = "";

export function highlight(code, lang) {
  lang = (lang || "").toLowerCase();
  const alias = { py: "python", js: "javascript", ts: "typescript", sh: "shell", bash: "shell", ps1: "powershell", ps: "powershell", jsx: "javascript", tsx: "typescript", yml: "yaml", htm: "html", xml: "html", kotlin: "java", cpp: "c", cs: "c", csharp: "c" };
  lang = alias[lang] || lang;
  const src = String(code ?? "");
  if (!KW[lang] && lang !== "html" && lang !== "css") return esc(src);
  if (lang === "html") {
    return esc(src)
      .replace(/(&lt;!--[\s\S]*?--&gt;)/g, '<span class="tok-c">$1</span>')
      .replace(/(&lt;\/?)([\w-]+)/g, '$1<span class="tok-k">$2</span>')
      .replace(/([\w-:]+)=(&quot;[^&]*?&quot;)/g, '<span class="tok-f">$1</span>=<span class="tok-s">$2</span>');
  }
  const words = new Set((KW[lang] || "").split(/\s+/).filter(Boolean));
  const ci = lang === "sql" || lang === "powershell";
  const hash = ["python", "shell", "yaml", "toml", "ruby", "powershell"].includes(lang);
  const dash = lang === "sql";
  const re = new RegExp([
    "(\\/\\*[\\s\\S]*?\\*\\/)",                           // 1 commento a blocco
    hash ? "(#[^\\n]*)" : (dash ? "(--[^\\n]*)" : "(\\/\\/[^\\n]*)"), // 2 commento di riga
    "(\"\"\"[\\s\\S]*?\"\"\"|'''[\\s\\S]*?'''|`(?:\\\\.|[^`\\\\])*`|\"(?:\\\\.|[^\"\\\\\\n])*\"|'(?:\\\\.|[^'\\\\\\n])*')", // 3 stringhe
    "(\\b\\d+(?:\\.\\d+)?\\b)",                           // 4 numeri
    "([A-Za-z_$][\\w$-]*)(?=\\s*\\()",                     // 5 chiamate
    "(@[\\w.]+|\\b[A-Z][A-Za-z0-9_]+\\b)",                 // 6 decoratori / tipi
    "([A-Za-z_$][\\w$]*)",                                 // 7 parole
  ].join("|"), "g");
  let out = "";
  let last = 0;
  for (const m of src.matchAll(re)) {
    out += esc(src.slice(last, m.index));
    last = m.index + m[0].length;
    const t = esc(m[0]);
    if (m[1] || m[2]) out += `<span class="tok-c">${t}</span>`;
    else if (m[3]) out += `<span class="tok-s">${t}</span>`;
    else if (m[4]) out += `<span class="tok-n">${t}</span>`;
    else if (m[5]) out += words.has(ci ? m[5].toLowerCase() : m[5]) ? `<span class="tok-k">${t}</span>` : `<span class="tok-f">${t}</span>`;
    else if (m[6]) out += words.has(ci ? m[6].toLowerCase() : m[6]) ? `<span class="tok-k">${t}</span>` : `<span class="tok-t">${t}</span>`;
    else if (m[7]) out += words.has(ci ? m[7].toLowerCase() : m[7]) ? `<span class="tok-k">${t}</span>` : t;
    else out += t;
  }
  out += esc(src.slice(last));
  return out;
}

function codeView(text, lang) {
  // evidenzia tutto insieme (le stringhe su più righe restano corrette), poi spezza in righe
  const html = highlight(text, lang);
  const lines = [];
  let open = [];
  for (const raw of html.split("\n")) {
    const prefix = open.join("");
    const tags = raw.match(/<span class="[^"]+">|<\/span>/g) || [];
    for (const tg of tags) { if (tg === "</span>") open.pop(); else open.push(tg); }
    lines.push(`<span class="ln">${prefix}${raw}${"</span>".repeat(open.length)}</span>`);
  }
  return `<div class="code-view">${lines.join("")}</div>`;
}

// ---------------------------------------------------------------------------
// Componente
// ---------------------------------------------------------------------------
export async function openArtifact(container, id, { api, t, onClose, toast, fmtWhen }) {
  container.innerHTML = `<div class="viewer"><div class="viewer-head"><span class="kind">${icon("i-file")}</span><div class="ttl"><div class="name">…</div><div class="meta">&nbsp;</div></div></div><div class="viewer-body"><div class="viewer-empty"><span class="working"><i></i><i></i><i></i></span></div></div></div>`;
  let art;
  try { art = await api(`/api/artifacts/${id}`); }
  catch (err) {
    const missing = err.status === 404;
    container.innerHTML = `<div class="viewer"><div class="viewer-head"><span class="kind">${icon("i-file")}</span><div class="ttl"><div class="name">${t("tabArtifact")}</div></div><div class="acts"><button class="icon-btn" data-close title="${t("close")}">${icon("i-x")}</button></div></div><div class="viewer-empty"><h4>${missing ? t("fileMissing") : esc(err.message)}</h4></div></div>`;
    container.querySelector("[data-close]")?.addEventListener("click", () => onClose?.());
    return null;
  }
  const c = art.content || {};
  const raw = `/api/artifacts/${art.id}/raw`;
  const site = `/api/artifacts/${art.id}/site/${encodeURIComponent(art.title.split("/").pop())}`;
  const name = art.title.split("/").pop();
  const folder = art.title.includes("/") ? art.title.slice(0, art.title.lastIndexOf("/")) : "";
  const canToggle = art.kind === "html" || (art.kind === "document" && c.text != null && /\.(md|markdown)$/i.test(name));
  const textual = c.text != null;
  const meta = [t(`kind_${art.kind}`), c.lang && art.kind === "code" ? c.lang : "", fmtBytes(art.size), art.versions > 1 ? `v${art.versions}` : "", folder].filter(Boolean).join(" · ");
  container.innerHTML = `
    <div class="viewer">
      <div class="viewer-head">
        <span class="kind">${kindIcon(art.kind)}</span>
        <div class="ttl"><div class="name" title="${esc(art.path)}">${esc(name)}</div><div class="meta">${esc(meta)}</div></div>
        <div class="acts">
          ${canToggle ? `<div class="seg" data-mode><button data-m="preview" class="on">${icon("i-eye", "s")}${t("vPreview")}</button><button data-m="source">${icon("i-code", "s")}${t("vSource")}</button></div>` : ""}
          ${textual ? `<button class="icon-btn" data-copy-all title="${t("copyContent")}">${icon("i-copy")}</button>` : ""}
          <a class="icon-btn" href="${raw}?download=1" title="${t("download")}">${icon("i-download")}</a>
          ${["html", "image", "pdf"].includes(art.kind) ? `<a class="icon-btn" href="${art.kind === "html" ? site : raw}" target="_blank" rel="noopener" title="${t("openNew")}">${icon("i-external")}</a>` : ""}
          ${onClose ? `<button class="icon-btn" data-close title="${t("close")}">${icon("i-x")}</button>` : ""}
        </div>
      </div>
      ${c.truncated ? `<div class="viewer-note">${t("truncated")}</div>` : ""}
      ${c.converted ? `<div class="viewer-note">${t("converted")}</div>` : ""}
      <div class="viewer-body"></div>
    </div>`;
  const body = container.querySelector(".viewer-body");
  const render = (mode) => {
    if (c.error) { body.innerHTML = `<div class="viewer-empty"><h4>${esc(c.error)}</h4></div>`; return; }
    switch (art.kind) {
      case "html":
        body.innerHTML = mode === "source" ? codeView(c.text || "", "html")
          : `<iframe sandbox="allow-scripts allow-forms allow-modals" referrerpolicy="no-referrer" src="${site}" title="${esc(name)}"></iframe>`;
        break;
      case "image":
        body.innerHTML = `<div class="img-wrap"><img src="${raw}" alt="${esc(name)}"></div>`;
        break;
      case "pdf":
        body.innerHTML = `<iframe src="${raw}" title="${esc(name)}"></iframe>`;
        break;
      case "code":
        body.innerHTML = codeView(c.text || "", c.lang);
        break;
      case "data":
        if (c.rows) {
          const [head = [], ...rows] = c.rows;
          body.innerHTML = `<div class="data-view"><table><thead><tr><th class="rn"></th>${head.map((h) => `<th>${esc(h)}</th>`).join("")}</tr></thead><tbody>${rows.slice(0, 500).map((r, i) => `<tr><td class="rn">${i + 1}</td>${head.map((_, j) => `<td title="${esc(r[j] ?? "")}">${esc(r[j] ?? "")}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`;
        } else body.innerHTML = `<div class="doc plain">${esc(c.text || "")}</div>`;
        break;
      case "archive":
        body.innerHTML = c.entries ? `<div class="zip-view"><div class="muted"><span>${c.entries.length} ${t("zipEntries")}</span><span></span></div>${c.entries.map((e) => `<div><span>${esc(e.name)}</span><span>${e.name.endsWith("/") ? "" : fmtBytes(e.size)}</span></div>`).join("")}</div>`
          : `<div class="viewer-empty"><h4>${t("noPreview")}</h4></div>`;
        break;
      case "document":
      case "slides":
        if (c.text == null) { body.innerHTML = `<div class="viewer-empty"><h4>${t("noPreview")}</h4></div>`; break; }
        if (mode === "source") body.innerHTML = codeView(c.text, "markdown");
        else if (/\.(md|markdown)$/i.test(name)) { body.innerHTML = `<article class="doc">${renderMarkdown(c.text)}</article>`; body.querySelectorAll("pre code[data-lang]").forEach((el) => { el.innerHTML = highlight(el.textContent, el.dataset.lang); }); }
        else body.innerHTML = `<article class="doc plain">${esc(c.text)}</article>`;
        break;
      default:
        body.innerHTML = c.text != null ? `<article class="doc plain">${esc(c.text)}</article>` : `<div class="viewer-empty"><h4>${t("noPreview")}</h4><a class="btn" href="${raw}?download=1">${icon("i-download", "s")}${t("download")}</a></div>`;
    }
  };
  render("preview");
  container.querySelectorAll("[data-mode] button").forEach((b) => b.addEventListener("click", () => {
    container.querySelectorAll("[data-mode] button").forEach((x) => x.classList.toggle("on", x === b));
    render(b.dataset.m);
  }));
  container.querySelector("[data-close]")?.addEventListener("click", () => onClose?.());
  container.querySelector("[data-copy-all]")?.addEventListener("click", () => {
    navigator.clipboard?.writeText(c.text || "").then(() => toast?.(t("copied")));
  });
  return art;
}
