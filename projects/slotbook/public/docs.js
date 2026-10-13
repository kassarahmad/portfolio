"use strict";
// Renders /api/v1/openapi.json as a readable endpoint list (no external CDN).
(async () => {
  const main = document.getElementById("main");
  const h = (tag, cls, text) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text) e.textContent = text;
    return e;
  };
  try {
    const spec = await (await fetch("/api/v1/openapi.json")).json();
    const intro = h("p", "muted", spec.info.description);
    const out = [
      h("h1", null, `${spec.info.title} ${spec.info.version}`),
      intro,
      h("p", "small", "Base URL: /api/v1. Endpoints marked 🔒 need Authorization: Bearer <accessToken>."),
    ];
    for (const [path, ops] of Object.entries(spec.paths)) {
      for (const [method, op] of Object.entries(ops)) {
        if (method === "parameters") continue;
        const box = h("section", "panel");
        const title = h("h2", null, `${method.toUpperCase()} ${path}${op.security ? " 🔒" : ""}`);
        box.append(title, h("p", null, op.summary));
        if (op.description) box.append(h("p", "muted small", op.description));
        const params = [...(ops.parameters || []), ...(op.parameters || [])];
        if (params.length)
          box.append(
            h(
              "p",
              "small",
              "Parameters: " + params.map((p) => `${p.name} (${p.in}${p.required ? ", required" : ""})`).join(", "),
            ),
          );
        box.append(
          h(
            "p",
            "small muted",
            "Responses: " +
              Object.entries(op.responses)
                .map(([c, r]) => `${c} ${r.description}`)
                .join(" · "),
          ),
        );
        out.push(box);
      }
    }
    main.replaceChildren(...out);
  } catch (e) {
    main.replaceChildren(h("h1", null, "API documentation"), h("p", "error", `Couldn't load the spec: ${e.message}`));
  }
})();
