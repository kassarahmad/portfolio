// Minimal safe templating: interpolations are escaped unless they are Raw.
export class Raw {
  constructor(value) {
    this.value = String(value);
  }
  toString() {
    return this.value;
  }
}

export const raw = (v) => new Raw(v);

export function escape(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function render(value) {
  if (value === null || value === undefined || value === false) return "";
  if (value instanceof Raw) return value.value;
  if (Array.isArray(value)) return value.map(render).join("");
  return escape(value);
}

export function html(strings, ...values) {
  let out = strings[0];
  values.forEach((v, i) => {
    out += render(v) + strings[i + 1];
  });
  return new Raw(out);
}

// Inline markup for content strings: `code` and [text](url). Everything else is escaped.
export function inline(text) {
  const parts = [];
  const re = /`([^`]+)`|\[([^\]]+)\]\(([^)\s]+)\)/g;
  let last = 0;
  let m;
  while ((m = re.exec(text))) {
    parts.push(escape(text.slice(last, m.index)));
    if (m[1] !== undefined) parts.push(`<code>${escape(m[1])}</code>`);
    else {
      const href = m[3];
      if (!/^(https?:|mailto:|\/|#)/.test(href)) throw new Error(`Unsafe link in content: ${href}`);
      const ext = /^https?:/.test(href);
      parts.push(`<a href="${escape(href)}"${ext ? ' rel="noopener"' : ""}>${escape(m[2])}</a>`);
    }
    last = re.lastIndex;
  }
  parts.push(escape(text.slice(last)));
  return raw(parts.join(""));
}
