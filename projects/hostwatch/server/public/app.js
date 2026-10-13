"use strict";
// Hostwatch dashboard. Live updates over Server-Sent Events with reconnection;
// after repeated failures it falls back to polling and keeps retrying the stream.
(() => {
  const main = document.getElementById("main");
  const connEl = document.getElementById("conn");
  const logoutBtn = document.getElementById("logout");
  const SVG = "http://www.w3.org/2000/svg";
  const state = {
    hosts: new Map(),
    alerts: [],
    spark: new Map(),
    view: { name: "overview" },
    es: null,
    failures: 0,
    poll: null,
  };

  // ---------- helpers ----------
  function h(tag, attrs = {}, ...kids) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (v === null || v === undefined || v === false) continue;
      if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
      else if (k === "class") el.className = v;
      else el.setAttribute(k, v === true ? "" : String(v));
    }
    for (const kid of kids.flat())
      if (kid !== null && kid !== undefined && kid !== false) el.append(kid instanceof Node ? kid : String(kid));
    return el;
  }
  function s(tag, attrs = {}, ...kids) {
    const el = document.createElementNS(SVG, tag);
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
    for (const kid of kids) el.append(kid);
    return el;
  }
  const pct = (v) => (v === null || v === undefined ? "–" : `${v.toFixed(1)}%`);
  const bytes = (n) => {
    if (n === null || n === undefined) return "–";
    const u = ["B", "KB", "MB", "GB", "TB"];
    let i = 0;
    while (n >= 1024 && i < u.length - 1) {
      n /= 1024;
      i++;
    }
    return `${n.toFixed(n >= 10 || i === 0 ? 0 : 1)} ${u[i]}`;
  };
  const ago = (iso) => {
    const sec = Math.round((Date.now() - Date.parse(iso)) / 1000);
    return sec < 60
      ? `${sec}s ago`
      : sec < 3600
        ? `${Math.round(sec / 60)} min ago`
        : `${Math.round(sec / 3600)} h ago`;
  };
  const uptime = (sec) =>
    sec >= 86400
      ? `${Math.floor(sec / 86400)} d ${Math.floor((sec % 86400) / 3600)} h`
      : `${Math.floor(sec / 3600)} h ${Math.floor((sec % 3600) / 60)} min`;
  const level = (v, warn, crit) => (v === null ? "" : v >= crit ? "critical" : v >= warn ? "warning" : "");
  const STATUS = { ok: "OK", warning: "Warning", critical: "Critical", silent: "No data" };
  const diskMax = (sample) => (sample.disks.length ? Math.max(...sample.disks.map((d) => d.usedPct)) : null);

  async function api(path, opts = {}) {
    const res = await fetch(path, { credentials: "same-origin", ...opts });
    if (res.status === 401 && !path.endsWith("/login")) {
      showLogin();
      throw new Error("Signed out");
    }
    const data = res.status === 204 ? null : await res.json().catch(() => null);
    if (!res.ok) throw new Error(data?.error?.message || `Request failed (${res.status})`);
    return data;
  }

  function setConn(kind, text) {
    connEl.className = `conn ${kind}`;
    connEl.textContent = text;
  }

  // ---------- data ----------
  function applySnapshot(snap) {
    state.hosts = new Map(snap.hosts.map((x) => [x.name, x]));
    state.alerts = snap.alerts;
    redraw();
  }
  function applySample({ host, point }) {
    state.hosts.set(host.name, host);
    const arr = state.spark.get(host.name) || [];
    arr.push(point.cpu);
    if (arr.length > 60) arr.shift();
    state.spark.set(host.name, arr);
    if (state.view.name === "overview") redraw();
    else if (state.view.name === "host" && state.view.host === host.name) drawHostHeader();
  }
  async function refreshAlerts() {
    state.alerts = (await api("/api/v1/alerts?state=open")).data;
    if (state.view.name === "overview") redraw();
  }

  // ---------- live connection ----------
  function connect() {
    state.es?.close();
    const es = new EventSource("/api/v1/stream");
    state.es = es;
    es.addEventListener("open", () => {
      state.failures = 0;
      stopPolling();
      setConn("live", "Live");
    });
    es.addEventListener("snapshot", (e) => applySnapshot(JSON.parse(e.data)));
    es.addEventListener("sample", (e) => applySample(JSON.parse(e.data)));
    es.addEventListener("alert", () => refreshAlerts().catch(() => {}));
    es.addEventListener("error", () => {
      state.failures++;
      if (state.failures >= 3) {
        // The browser retries on its own; after three failures, also poll so the page stays current.
        es.close();
        startPolling();
        setTimeout(connect, 30_000);
      } else {
        setConn("retry", "Reconnecting…");
      }
    });
  }
  function startPolling() {
    if (state.poll) return;
    setConn("retry", "Live updates unavailable. Refreshing every 10 s");
    const run = () =>
      api("/api/v1/hosts")
        .then(applySnapshot)
        .catch(() => {});
    run();
    state.poll = setInterval(run, 10_000);
  }
  function stopPolling() {
    clearInterval(state.poll);
    state.poll = null;
  }

  // ---------- views ----------
  function redraw() {
    if (state.view.name === "overview") drawOverview();
  }

  function drawOverview() {
    const hosts = [...state.hosts.values()];
    const alertList = state.alerts.length
      ? h(
          "ul",
          { class: "alerts", "aria-label": "Open alerts" },
          state.alerts.map((a) =>
            h(
              "li",
              { class: a.severity },
              h("strong", {}, a.severity === "critical" ? "Critical: " : "Warning: "),
              a.message,
              h("span", { class: "muted small" }, ` · since ${ago(a.startedAt)}`),
            ),
          ),
        )
      : h("p", { class: "ok-line" }, "No open alerts.");
    const grid = hosts.length
      ? h("div", { class: "hosts" }, hosts.map(hostCard))
      : h(
          "div",
          { class: "empty" },
          "No hosts have reported yet. Start an agent with a token from HOSTWATCH_AGENT_TOKENS; see the README.",
        );
    main.replaceChildren(h("h1", {}, "Hosts"), alertList, grid);
  }

  function meter(label, value, warn, crit) {
    return h(
      "div",
      { class: "meter" },
      h("span", {}, label),
      h(
        "div",
        { class: "bar", role: "img", "aria-label": `${label} ${pct(value)}` },
        h("span", { class: level(value, warn, crit), style: null }),
      ),
      h("span", { class: "num" }, pct(value)),
    );
  }

  function hostCard(host) {
    const x = host.latest;
    const card = h(
      "button",
      { class: "host", type: "button", "aria-label": `${host.name}, ${STATUS[host.status]}. Open details` },
      h(
        "div",
        { class: "host-head" },
        h("strong", {}, host.name),
        host.simulated
          ? h(
              "span",
              { class: "badge sim", title: "Numbers come from the agent's simulator, not a real machine" },
              "Simulated",
            )
          : null,
        h("span", { class: `badge ${host.status}` }, STATUS[host.status]),
      ),
      meter("CPU", x.cpu.usagePct, 75, 90),
      meter("Memory", x.mem.usedPct, 80, 90),
      meter("Disk", diskMax(x), 75, 85),
      h(
        "p",
        { class: "muted small" },
        `Load ${x.load.map((l) => l.toFixed(2)).join(" ")} · up ${uptime(x.uptimeSec)} · seen ${ago(host.lastSeen)}`,
      ),
      sparkline(state.spark.get(host.name) || []),
    );
    // Widths are set through the CSSOM: allowed by the CSP, unlike inline style attributes.
    card.querySelectorAll(".bar span").forEach((el, i) => {
      el.style.width = `${Math.max(0, Math.min(100, [x.cpu.usagePct, x.mem.usedPct, diskMax(x)][i] ?? 0))}%`;
    });
    card.addEventListener("click", () => openHost(host.name));
    return card;
  }

  function sparkline(values) {
    if (values.length < 2) return h("p", { class: "muted small spark" }, "Collecting live CPU history…");
    const w = 240,
      ht = 36;
    const d = values
      .map(
        (v, i) => `${i ? "L" : "M"}${((i / (values.length - 1)) * w).toFixed(1)},${(ht - (v / 100) * ht).toFixed(1)}`,
      )
      .join(" ");
    return s(
      "svg",
      {
        class: "spark",
        viewBox: `0 0 ${w} ${ht}`,
        role: "img",
        "aria-label": `CPU over the last ${values.length} samples`,
      },
      s("path", { d }),
    );
  }

  // ---------- host detail ----------
  async function openHost(name, range = "1h") {
    state.view = { name: "host", host: name, range };
    history.replaceState(null, "", `#host=${encodeURIComponent(name)}&range=${range}`);
    const header = h("div", { id: "host-header" });
    const charts = h("div", { class: "charts", "aria-live": "polite" }, h("p", { class: "muted" }, "Loading history…"));
    const ranges = h(
      "div",
      { class: "row", role: "group", "aria-label": "Time range" },
      ["1h", "6h", "24h", "48h"].map((r) =>
        h(
          "button",
          { class: "btn ghost", type: "button", "aria-pressed": String(r === range), onclick: () => openHost(name, r) },
          r,
        ),
      ),
    );
    main.replaceChildren(
      h("p", {}, h("button", { class: "link", type: "button", onclick: back }, "← All hosts")),
      header,
      ranges,
      charts,
      h("div", { id: "host-tables" }),
    );
    drawHostHeader();
    main.focus();
    try {
      const data = await api(`/api/v1/hosts/${encodeURIComponent(name)}/series?range=${range}`);
      if (!data.points.length) return charts.replaceChildren(h("div", { class: "empty" }, "No samples in this range."));
      const t = data.points.map((p) => p.t);
      charts.replaceChildren(
        chart("CPU", t, [data.points.map((p) => p.cpu)], { max: 100, unit: "%", limit: 90 }),
        chart("Memory", t, [data.points.map((p) => p.mem)], { max: 100, unit: "%", limit: 90 }),
        chart("Disk (fullest mount)", t, [data.points.map((p) => p.disk)], { max: 100, unit: "%", limit: 85 }),
        chart("Network in / out", t, [data.points.map((p) => p.rx), data.points.map((p) => p.tx)], {
          fmt: (v) => `${bytes(v)}/s`,
          unit: "/s",
        }),
      );
    } catch (e) {
      charts.replaceChildren(h("p", { class: "error" }, `Couldn't load history: ${e.message}`));
    }
  }

  function drawHostHeader() {
    const host = state.hosts.get(state.view.host);
    const box = document.getElementById("host-header");
    const tables = document.getElementById("host-tables");
    if (!host || !box) return;
    const x = host.latest;
    box.replaceChildren(
      h(
        "h1",
        {},
        host.name,
        " ",
        h("span", { class: `badge ${host.status}` }, STATUS[host.status]),
        host.simulated ? h("span", { class: "badge sim" }, " Simulated data") : "",
      ),
      h(
        "p",
        { class: "muted" },
        `${x.cpu.cores} cores · ${bytes(x.mem.totalBytes)} RAM · up ${uptime(x.uptimeSec)} · last sample ${ago(host.lastSeen)}`,
      ),
    );
    tables.replaceChildren(
      h("h2", {}, "Disks"),
      table(
        ["Mount", "Used", "Size"],
        x.disks.map((d) => [d.mount, pct(d.usedPct), bytes(d.totalBytes)]),
        "No disks reported.",
      ),
      h("h2", {}, "Services"),
      table(
        ["Unit", "State"],
        x.services.map((v) => [v.name, v.state]),
        "No services configured on this agent (HOSTWATCH_SERVICES).",
      ),
      h("h2", {}, "Containers"),
      table(
        ["Name", "Image", "State", "Health"],
        x.containers.map((c) => [c.name, c.image, c.state, c.health]),
        "No containers reported (Docker access is optional).",
      ),
    );
  }

  function table(cols, rows, empty) {
    if (!rows.length) return h("p", { class: "muted small" }, empty);
    return h(
      "div",
      { class: "panel" },
      h(
        "table",
        {},
        h(
          "thead",
          {},
          h(
            "tr",
            {},
            cols.map((c) => h("th", { scope: "col" }, c)),
          ),
        ),
        h(
          "tbody",
          {},
          rows.map((r) =>
            h(
              "tr",
              {},
              r.map((c) => h("td", {}, c)),
            ),
          ),
        ),
      ),
    );
  }

  function chart(title, t, series, { max, unit = "", limit, fmt } = {}) {
    const W = 320,
      H = 140,
      L = 34,
      B = 18,
      T = 8;
    const all = series.flat().filter((v) => v !== null);
    const top = max ?? Math.max(1, ...all) * 1.1;
    const x = (i) => L + ((t[i] - t[0]) / Math.max(1, t.at(-1) - t[0])) * (W - L - 4);
    const y = (v) => T + (1 - v / top) * (H - T - B);
    const label = fmt ? fmt : (v) => `${Math.round(v)}${unit}`;
    const svg = s("svg", {
      viewBox: `0 0 ${W} ${H}`,
      role: "img",
      "aria-label": `${title}: latest ${series.map((sr) => label(sr.at(-1) ?? 0)).join(" and ")}`,
    });
    const grid = s("g", { class: "grid" });
    for (const f of [0, 0.5, 1]) {
      grid.append(s("line", { x1: L, x2: W - 4, y1: y(top * f), y2: y(top * f) }));
      grid.append(
        s(
          "text",
          { x: 2, y: y(top * f) + 3 },
          document.createTextNode(fmt ? fmt(top * f) : `${Math.round(top * f)}${unit}`),
        ),
      );
    }
    svg.append(grid);
    if (limit) svg.append(s("line", { class: "limit", x1: L, x2: W - 4, y1: y(limit), y2: y(limit) }));
    series.forEach((sr, k) => {
      let d = "",
        pen = false;
      sr.forEach((v, i) => {
        if (v === null) {
          pen = false;
          return;
        }
        d += `${pen ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)} `;
        pen = true;
      });
      svg.append(s("path", { class: `s${k + 1}`, d }));
    });
    const fmtTime = (ms) => new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    svg.append(s("text", { x: L, y: H - 4 }, document.createTextNode(fmtTime(t[0]))));
    svg.append(s("text", { x: W - 4, y: H - 4, "text-anchor": "end" }, document.createTextNode(fmtTime(t.at(-1)))));
    return h("figure", { class: "panel chart" }, h("figcaption", {}, h("strong", {}, title)), svg);
  }

  function back() {
    state.view = { name: "overview" };
    history.replaceState(null, "", location.pathname);
    drawOverview();
  }

  // ---------- sign-in ----------
  function showLogin() {
    state.es?.close();
    stopPolling();
    setConn("", "Signed out");
    logoutBtn.hidden = true;
    const input = h("input", { id: "pw", type: "password", autocomplete: "current-password", required: true });
    const err = h("p", { class: "error", role: "alert" });
    const form = h(
      "form",
      { class: "panel" },
      h("label", { for: "pw" }, "Dashboard password"),
      input,
      err,
      h("p", {}, h("button", { class: "btn" }, "Sign in")),
    );
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      try {
        await api("/api/v1/login", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ password: input.value }),
        });
        start();
      } catch (ex) {
        err.textContent = ex.message;
      }
    });
    main.replaceChildren(h("h1", {}, "Sign in"), form);
    input.focus();
  }

  logoutBtn.addEventListener("click", async () => {
    await api("/api/v1/logout", { method: "POST" }).catch(() => {});
    showLogin();
  });

  async function start() {
    logoutBtn.hidden = false;
    setConn("retry", "Connecting…");
    applySnapshot(await api("/api/v1/hosts"));
    connect();
    const m = /host=([^&]+)&range=(\w+)/.exec(location.hash);
    if (m && state.hosts.has(decodeURIComponent(m[1]))) openHost(decodeURIComponent(m[1]), m[2]);
  }

  setInterval(() => {
    if (state.view.name === "overview") redraw();
  }, 15_000); // keep "seen …ago" honest
  api("/api/v1/session")
    .then((r) => (r.authenticated ? start() : showLogin()))
    .catch(() => showLogin());
})();
