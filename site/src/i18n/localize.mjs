// Merges an English content tree with a translation tree of the same shape.
// Every translatable string must be present in the translation, or the build
// fails and names the missing path. Non-translatable fields (ids, URLs, code,
// technology names, evidence levels) always come from the English base.

const NON_TRANSLATABLE = new Set([
  "slug",
  "stack",
  "categories",
  "links",
  "repoPath",
  "featured",
  "period",
  "id",
  "width",
  "height",
  "nodes",
  "edges",
  "text",
  "lang",
  "src",
  "w",
  "h",
  "email",
  "phone",
  "github",
  "name",
  "headline",
  "evidence",
  "privateCount",
  "level",
]);
// Tuples whose second element is an evidence or skill level code.
const LEVEL_TUPLES = new Set(["items", "ledger"]);

export class MissingTranslation extends Error {}

export function localize(base, tr, path = "", key = "") {
  if (base === null || base === undefined) return base;
  if (typeof base === "string") {
    if (typeof tr !== "string" || !tr.trim()) throw new MissingTranslation(`missing translation at ${path}`);
    return tr;
  }
  if (typeof base !== "object") return base; // numbers, booleans
  if (Array.isArray(base)) {
    if (!Array.isArray(tr) || tr.length !== base.length)
      throw new MissingTranslation(
        `${path}: expected ${base.length} items, got ${Array.isArray(tr) ? tr.length : typeof tr}`,
      );
    return base.map((item, i) => {
      if (LEVEL_TUPLES.has(key) && Array.isArray(item)) {
        // [label, levelCode, detail]: translate 0 and 2, keep 1
        return item.map((v, j) => (j === 1 ? v : localize(v, tr[i]?.[j], `${path}[${i}][${j}]`)));
      }
      return localize(item, tr[i], `${path}[${i}]`, key);
    });
  }
  if (tr === null || typeof tr !== "object") throw new MissingTranslation(`missing translation object at ${path}`);
  const out = {};
  for (const [k, v] of Object.entries(base)) {
    out[k] = NON_TRANSLATABLE.has(k) ? v : localize(v, tr[k], path ? `${path}.${k}` : k, k);
  }
  return out;
}
