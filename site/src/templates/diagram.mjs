import { escape, raw } from "./html.mjs";

// Small architecture-diagram renderer. Nodes are boxes; edges are straight or
// elbow connectors between box sides. Colours come from CSS classes, so the
// same SVG works in light and dark themes.
function anchor(n, side) {
  const cx = n.x + n.w / 2;
  const cy = n.y + n.h / 2;
  switch (side) {
    case "left":
      return [n.x, cy];
    case "right":
      return [n.x + n.w, cy];
    case "top":
      return [cx, n.y];
    case "bottom":
      return [cx, n.y + n.h];
    default:
      throw new Error(`bad side ${side}`);
  }
}

function autoSides(a, b) {
  const dx = b.x + b.w / 2 - (a.x + a.w / 2);
  const dy = b.y + b.h / 2 - (a.y + a.h / 2);
  if (Math.abs(dx) * 0.6 >= Math.abs(dy)) return dx > 0 ? ["right", "left"] : ["left", "right"];
  return dy > 0 ? ["bottom", "top"] : ["top", "bottom"];
}

export function diagram({ id, width, height, title, nodes, edges }) {
  const byId = Object.fromEntries(nodes.map((n) => [n.id, n]));
  const marker = `arrow-${id}`;
  const parts = [];
  parts.push(
    `<svg viewBox="0 0 ${width} ${height}" role="img" aria-labelledby="${id}-t" xmlns="http://www.w3.org/2000/svg">`,
  );
  parts.push(`<title id="${id}-t">${escape(title)}</title>`);
  parts.push(
    `<defs><marker id="${marker}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path class="arrow" d="M0,0 L10,5 L0,10 z"/></marker></defs>`,
  );

  for (const e of edges) {
    const a = byId[e.from];
    const b = byId[e.to];
    if (!a || !b) throw new Error(`diagram ${id}: unknown edge ${e.from} -> ${e.to}`);
    const [sa, sb] = e.sides ?? autoSides(a, b);
    const [x1, y1] = anchor(a, sa);
    const [x2, y2] = anchor(b, sb);
    let d;
    if (x1 === x2 || y1 === y2) d = `M${x1},${y1} L${x2},${y2}`;
    else if (sa === "left" || sa === "right") {
      const mx = Math.round((x1 + x2) / 2);
      d = `M${x1},${y1} L${mx},${y1} L${mx},${y2} L${x2},${y2}`;
    } else {
      const my = Math.round((y1 + y2) / 2);
      d = `M${x1},${y1} L${x1},${my} L${x2},${my} L${x2},${y2}`;
    }
    const ends = e.both ? ` marker-start="url(#${marker})"` : "";
    parts.push(`<path class="edge" d="${d}" marker-end="url(#${marker})"${ends}/>`);
    if (e.label) {
      const lx = e.labelAt?.[0] ?? (x1 + x2) / 2;
      const ly = e.labelAt?.[1] ?? (y1 + y2) / 2 - 6;
      parts.push(`<text class="edge-label" x="${lx}" y="${ly}" text-anchor="middle">${escape(e.label)}</text>`);
    }
  }

  for (const n of nodes) {
    const cls = ["node", n.kind].filter(Boolean).join(" ");
    const cx = n.x + n.w / 2;
    const ty = n.sub ? n.y + n.h / 2 - 3 : n.y + n.h / 2 + 4;
    parts.push(`<g class="${cls}"><rect x="${n.x}" y="${n.y}" width="${n.w}" height="${n.h}" rx="5"/>`);
    parts.push(`<text x="${cx}" y="${ty}" text-anchor="middle">${escape(n.label)}</text>`);
    if (n.sub) parts.push(`<text class="sub" x="${cx}" y="${ty + 16}" text-anchor="middle">${escape(n.sub)}</text>`);
    parts.push(`</g>`);
  }
  parts.push(`</svg>`);
  return raw(parts.join(""));
}
