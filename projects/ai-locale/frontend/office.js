// L'ufficio animato: ogni agente ha il suo ufficio, la sua scrivania e il suo PC.
// Lo stato di ogni agente arriva dagli eventi reali del motore multi-agente
// (nessuna attività inventata): pianifica, pensa, usa strumenti, si consulta,
// aspetta la tua approvazione, viene revisionato, consegna.

import { esc } from "./markdown.js";

// Reparti dell'azienda (mostrati sulla porta di ogni ufficio)
const DEPT_OF = {
  coordinatore: "direzione", ricercatore: "ricerca", analista: "ricerca",
  programmatore: "sviluppo", operatore: "sviluppo", scrittore: "comunicazione", critico: "qualita",
  navigatore: "ricerca", visione: "ricerca",
};

// Aspetto dei personaggi: carnagione, capelli, stile, accessorio
const LOOKS = {
  coordinatore: { skin: "#f1c27d", hair: "#2b1d14", style: "side", extra: "tie" },
  ricercatore: { skin: "#e0ac69", hair: "#1a1a1a", style: "bun", extra: "glasses" },
  programmatore: { skin: "#c68642", hair: "#111", style: "curly", extra: "headphones" },
  analista: { skin: "#ffdbac", hair: "#a0522d", style: "long", extra: "" },
  scrittore: { skin: "#8d5524", hair: "#0d0d0d", style: "short", extra: "" },
  operatore: { skin: "#f1c27d", hair: "#6b4f3a", style: "cap", extra: "" },
  critico: { skin: "#ffe0bd", hair: "#9e9e9e", style: "bald", extra: "glasses" },
  navigatore: { skin: "#d9a066", hair: "#3b2a1a", style: "cap", extra: "" },
  visione: { skin: "#f5d0b0", hair: "#5e2d79", style: "long", extra: "glasses" },
};

const DECOR = {
  coordinatore: "chart", ricercatore: "books", programmatore: "poster", analista: "chart",
  scrittore: "plant", operatore: "rack", critico: "clock", navigatore: "poster", visione: "chart",
};

function hairSvg(look) {
  const h = look.hair;
  switch (look.style) {
    case "bun": return `<path d="M137 44 q2-16 14-16 q13 0 13 15 q-5-7-14-7 q-8 0-13 8z" fill="${h}"/><circle cx="160" cy="29" r="5" fill="${h}"/>`;
    case "curly": return `<g fill="${h}"><circle cx="141" cy="37" r="5"/><circle cx="148" cy="32" r="6"/><circle cx="156" cy="32" r="6"/><circle cx="162" cy="38" r="5"/><circle cx="163" cy="45" r="4"/></g>`;
    case "long": return `<path d="M137 46 q0-18 14-18 q14 0 14 18 l1 18 q-6 2-9-2 l-1-14 q-5-6-13-6 q-5 2-6 4z" fill="${h}"/>`;
    case "short": return `<path d="M138 42 q1-12 13-12 q12 0 13 12 q-6-5-13-5 q-8 0-13 5z" fill="${h}"/>`;
    case "cap": return `<path d="M137 41 q1-11 14-11 q13 0 13 11z" fill="#3b4a5a"/><rect x="128" y="39" width="18" height="3" rx="1.5" fill="#3b4a5a"/>`;
    case "bald": return `<path d="M161 40 q3 2 3 8 q-3-2-4-6z" fill="${h}"/>`;
    default: return `<path d="M138 43 q0-13 13-13 q13 0 13 12 q-9-4-17-1 q-5 1-9 2z" fill="${h}"/>`;
  }
}

function decorSvg(kind) {
  switch (kind) {
    case "books": return `<g transform="translate(160 14)"><rect width="30" height="2" fill="var(--o-shelf)"/><rect x="2" y="-12" width="4" height="12" fill="#c0392b"/><rect x="7" y="-10" width="4" height="10" fill="#2980b9"/><rect x="12" y="-13" width="3" height="13" fill="#27ae60"/><rect x="16" y="-9" width="5" height="9" fill="#f39c12"/></g>`;
    case "poster": return `<g transform="translate(164 6)"><rect width="24" height="18" rx="1" fill="#1e2430"/><text x="12" y="12" font-size="7" text-anchor="middle" fill="#7c5cff" font-family="monospace">{ }</text></g>`;
    case "chart": return `<g transform="translate(163 5)"><rect width="26" height="19" rx="1" fill="var(--o-paper)"/><polyline points="3,15 9,10 14,12 20,5 23,7" fill="none" stroke="#22b573" stroke-width="1.5"/></g>`;
    case "rack": return `<g transform="translate(168 2)"><rect width="18" height="24" rx="1" fill="#2a2f3a"/><circle cx="4" cy="5" r="1" fill="#22b573" class="blink"/><circle cx="4" cy="11" r="1" fill="#22b573"/><circle cx="4" cy="17" r="1" fill="#e0a100" class="blink"/></g>`;
    case "clock": return `<g transform="translate(176 14)"><circle r="9" fill="var(--o-paper)" stroke="#555" stroke-width="1"/><line x1="0" y1="0" x2="0" y2="-6" stroke="#333" stroke-width="1.2" class="clock-hand"/><line x1="0" y1="0" x2="4" y2="0" stroke="#333" stroke-width="1.2"/></g>`;
    default: return `<g transform="translate(176 4)"><path d="M0 20 q-6-10 0-18 q6 8 0 18z M0 20 q8-8 10-16 q-9 4-10 16z M0 20 q-9-6-12-14 q10 2 12 14z" fill="#3fa36b"/></g>`;
  }
}

function sceneSvg(agent) {
  const look = LOOKS[agent.id] || LOOKS.scrittore;
  const shirt = agent.color;
  const glasses = look.extra === "glasses" ? `<g class="glasses" fill="none" stroke="#222" stroke-width="1"><circle cx="143.5" cy="45" r="3"/><line x1="146.5" y1="45" x2="152" y2="44"/></g>` : "";
  const phones = look.extra === "headphones" ? `<path d="M140 40 q11-16 24 0" fill="none" stroke="#222" stroke-width="2.4"/><rect x="152" y="41" width="5" height="8" rx="2" fill="#222"/>` : "";
  const tie = look.extra === "tie" ? `<path d="M145 62 l3 4 l-2 16 l-3 3 l-2-3 l1-16z" fill="#c0392b"/>` : "";
  return `
<svg viewBox="0 0 200 130" class="scene-svg" aria-hidden="true">
  <rect x="0" y="0" width="200" height="94" fill="var(--o-wall)"/>
  <g class="window"><rect x="8" y="8" width="42" height="30" rx="2" fill="var(--o-sky)"/><rect x="8" y="8" width="42" height="30" rx="2" fill="none" stroke="var(--o-frame)" stroke-width="2"/><line x1="29" y1="8" x2="29" y2="38" stroke="var(--o-frame)" stroke-width="1.5"/><circle class="sun" cx="42" cy="16" r="4" fill="var(--o-sun)"/></g>
  ${decorSvg(DECOR[agent.id])}
  <rect x="0" y="94" width="200" height="36" fill="var(--o-floor)"/>
  <rect class="chair" x="146" y="50" width="34" height="44" rx="9" fill="var(--o-chair)"/>
  <rect x="150" y="92" width="28" height="5" rx="2" fill="var(--o-chair)"/>
  <g class="person">
    <path d="M131 92 q-2-26 19-30 q19 2 19 30z" fill="${shirt}"/>
    ${tie}
    <rect x="146" y="55" width="8" height="8" fill="${look.skin}"/>
    <g class="head">
      <circle cx="151" cy="46" r="12" fill="${look.skin}"/>
      ${hairSvg(look)}
      <g class="eyes"><ellipse cx="143.5" cy="45" rx="1.3" ry="1.6" fill="#1b1b1b"/></g>
      <path class="mouth" d="M141 51.5 q2.5 1.5 5 0" fill="none" stroke="#7a3b2e" stroke-width="1.1" stroke-linecap="round"/>
      ${glasses}${phones}
    </g>
    <g class="arm arm-type"><path d="M140 68 q-14 6-30 14" fill="none" stroke="${shirt}" stroke-width="6" stroke-linecap="round"/><circle cx="109" cy="82.5" r="3.2" fill="${look.skin}"/></g>
    <g class="arm arm-think"><path d="M140 70 q-6 2-6-8" fill="none" stroke="${shirt}" stroke-width="6" stroke-linecap="round"/><circle cx="141" cy="57" r="3.2" fill="${look.skin}"/></g>
    <g class="arm arm-raise"><path d="M141 66 q-8-10-6-30" fill="none" stroke="${shirt}" stroke-width="6" stroke-linecap="round"/><circle cx="135" cy="33" r="3.4" fill="${look.skin}"/></g>
    <g class="arm arm-rest"><path d="M140 68 q-10 10-16 16" fill="none" stroke="${shirt}" stroke-width="6" stroke-linecap="round"/><circle cx="122" cy="84.5" r="3.2" fill="${look.skin}"/></g>
  </g>
  <rect x="18" y="86" width="168" height="6" rx="2" fill="var(--o-desk)"/>
  <rect x="24" y="92" width="160" height="26" rx="1" fill="var(--o-desk-2)"/>
  <rect x="38" y="33" width="80" height="50" rx="3" fill="#15181e"/>
  <rect x="74" y="83" width="10" height="3" fill="#2a2f3a"/>
  <rect x="64" y="84" width="34" height="2.4" rx="1" fill="#3a404d" class="keyboard"/>
  <g transform="translate(28 77)"><rect width="7" height="9" rx="1.5" fill="var(--o-mug)"/><path d="M7 2 q4 0 4 3 q0 3-4 3" fill="none" stroke="var(--o-mug)" stroke-width="1.4"/><path class="steam" d="M2 -2 q2 -3 0 -6 M5 -2 q2 -3 0 -6" fill="none" stroke="var(--o-steam)" stroke-width="0.8"/></g>
  <circle class="led" cx="114" cy="80" r="1.2" fill="#555"/>
</svg>`;
}

const codeLines = (n) => Array.from({ length: n }, (_, i) => {
  const w = 25 + ((i * 37) % 60);
  const ind = (i * 7) % 3;
  const cls = ["c1", "c2", "c3", "c4"][(i * 5) % 4];
  return `<i class="${cls}" style="width:${w}%;margin-left:${ind * 8}%"></i>`;
}).join("");

function screenHtml(state, tool, label) {
  switch (state) {
    case "thinking": return `<div class="scr-think"><b></b><b></b><b></b></div>`;
    case "assigned": return `<div class="scr-task"><div class="paper-mini"><i></i><i></i><i></i></div><span>${esc(label || "")}</span></div>`;
    case "waiting": return `<div class="scr-wait">!<span>OK?</span></div>`;
    case "done": return `<div class="scr-done">✓</div>`;
    case "error": return `<div class="scr-error">✕</div>`;
    case "reviewing": return `<div class="scr-review"><div class="paper-mini big"><i></i><i></i><i></i><i></i></div><div class="lens"></div></div>`;
    case "helping": case "asking": return `<div class="scr-chat"><i class="l"></i><i class="r"></i><i class="l"></i></div>`;
    case "working": {
      if (tool === "run_python" || tool === "run_command") return `<div class="scr-term"><div class="roll">${Array.from({ length: 14 }, (_, i) => `<i style="width:${30 + ((i * 29) % 60)}%"></i>`).join("")}</div><span class="cur">▍</span></div>`;
      if (tool && (tool.startsWith("browser_") || tool === "fetch_url" || tool === "web_search")) return `<div class="scr-web"><div class="bar"><i></i><span></span></div><div class="blocks"><i></i><i></i><i></i><i></i></div></div>`;
      if (tool === "analyze_image") return `<div class="scr-image"><div class="pic"></div><div class="lens"></div></div>`;
      if (tool === "search_documents") return `<div class="scr-search"><div class="paper-mini"><i></i><i class="hl"></i><i></i><i class="hl"></i></div><div class="lens"></div></div>`;
      if (tool === "read_file" || tool === "list_files") return `<div class="scr-files"><i></i><i></i><i></i><i></i><i></i><i></i></div>`;
      if (tool === "recall_memory" || tool === "remember") return `<div class="scr-mem"><div class="chip-ic"></div></div>`;
      if (tool === "ask_agent" || tool === "note") return `<div class="scr-chat"><i class="l"></i><i class="r"></i><i class="l"></i></div>`;
      return `<div class="scr-code"><div class="roll">${codeLines(18)}${codeLines(18)}</div></div>`;
    }
    case "writing": return `<div class="scr-code"><div class="roll">${codeLines(18)}${codeLines(18)}</div></div>`;
    default: return `<div class="scr-idle"><span></span></div>`;
  }
}

export class Office {
  constructor(root, agents, t) {
    this.root = root;
    this.agents = agents;
    this.t = t;
    this.instant = false;
    this.tasks = {};
    this.timer = null;
    this.ver = {};
    this.cur = {};
    this.saved = {};
    this.render();
  }

  render() {
    const t = this.t;
    const offices = Object.values(this.agents).map((a) => this.officeHtml(a)).join("");
    this.root.innerHTML = `
      <div class="office-top">
        <div class="job"><span class="job-lbl">${t("currentJob")}</span><span class="job-txt" data-job>${t("noJob")}</span></div>
        <div class="job-meta"><span class="clock" data-clock>00:00</span><div class="progress"><i data-progress></i></div><span data-progress-txt></span></div>
      </div>
      <div class="office-alerts" data-alerts></div>
      <div class="floor">
        ${offices}
        <div class="board" data-board style="grid-area:board"><div class="board-title">${t("blackboard")}</div><div class="board-notes"></div><div class="board-tray"><i></i><i></i><i></i></div></div>
        <div class="fly-layer" data-fly></div>
      </div>`;
  }

  officeHtml(a) {
    const dept = DEPT_OF[a.id];
    return `
      <div class="office st-idle" data-office="${a.id}" style="--c:${a.color};grid-area:${a.id}">
        <div class="door"><span class="plate">${esc(a.name)}</span>${dept ? `<span class="dept-tag">${esc(this.t(`dept_${dept}`))}</span>` : ""}<span class="lamp"></span></div>
        <div class="scene"><div class="scene-in">${sceneSvg(a)}
          <div class="screen">${screenHtml("idle")}</div>
          <div class="o-bubble"></div>
        </div></div>
        <div class="desk-status" data-status>${this.t("st_idle")}</div>
      </div>`;
  }

  el(id) { return this.root.querySelector(`[data-office="${id}"]`); }

  stateOf(id) { return this.cur[id]?.state || "idle"; }

  // Applica uno stato dopo un'animazione, solo se nel frattempo non è arrivato un evento più recente
  setAfter(promise, id, state, opts) {
    const v = this.ver[id] || 0;
    promise.then(() => { if ((this.ver[id] || 0) === v) this.set(id, state, opts); });
  }

  set(id, state, { text = "", tool = "", bubble = null, label = "" } = {}) {
    const el = this.el(id);
    if (!el) return;
    this.ver[id] = (this.ver[id] || 0) + 1;
    this.cur[id] = { state, opts: { text, tool, bubble, label } };
    el.className = `office st-${state}`;
    el.querySelector(".screen").innerHTML = screenHtml(state, tool, label);
    el.querySelector("[data-status]").textContent = text || this.t(`st_${state}`);
    const b = el.querySelector(".o-bubble");
    if (bubble) {
      b.textContent = bubble;
      b.className = `o-bubble show ${state === "thinking" ? "thought" : ""}`;
    } else {
      b.className = "o-bubble";
    }
  }

  // Un agente interrompe il suo lavoro per aiutare un collega e poi lo riprende
  startHelping(id, opts) {
    const c = this.cur[id];
    if (c && c.state !== "helping") this.saved[id] = c;
    this.set(id, "helping", opts);
  }

  stopHelping(id) {
    if (this.cur[id]?.state !== "helping") return;
    const prev = this.saved[id];
    delete this.saved[id];
    if (prev && prev.state !== "idle") this.set(id, prev.state, prev.opts);
    else this.set(id, "idle", { text: this.t("st_back") });
  }

  reset() {
    this.saved = {};
    Object.keys(this.agents).forEach((id) => this.set(id, "idle"));
    this.root.querySelector(".board-notes").innerHTML = "";
    this.root.querySelector("[data-alerts]").innerHTML = "";
    this.setJob(null);
    this.tasks = {};
    this.updateProgress();
  }

  setJob(text) {
    this.root.querySelector("[data-job]").textContent = text || this.t("noJob");
    clearInterval(this.timer);
    const clock = this.root.querySelector("[data-clock]");
    clock.textContent = "00:00";
    if (text && !this.instant) {
      const start = Date.now();
      this.timer = setInterval(() => {
        const s = Math.floor((Date.now() - start) / 1000);
        clock.textContent = `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
      }, 500);
    }
  }

  stopClock(seconds) {
    clearInterval(this.timer);
    if (seconds != null) {
      const s = Math.round(seconds);
      this.root.querySelector("[data-clock]").textContent = `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
    }
  }

  setTasks(tasks) {
    this.tasks = Object.fromEntries(tasks.map((x) => [x.id, { ...x, done: false }]));
    this.updateProgress();
  }

  finishTask(id) {
    if (this.tasks[id]) this.tasks[id].done = true;
    this.updateProgress();
  }

  updateProgress() {
    const all = Object.values(this.tasks);
    const done = all.filter((x) => x.done).length;
    this.root.querySelector("[data-progress]").style.width = all.length ? `${(done / all.length) * 100}%` : "0%";
    this.root.querySelector("[data-progress-txt]").textContent = all.length ? `${done}/${all.length} ${this.t("tasksDone")}` : "";
  }

  pin(agentId, text) {
    const notes = this.root.querySelector(".board-notes");
    const a = this.agents[agentId] || { color: "#888", name: agentId };
    const n = document.createElement("div");
    n.className = "sticky";
    n.style.setProperty("--c", a.color);
    n.innerHTML = `<b>${esc(a.name)}</b>${esc(text.slice(0, 70))}`;
    notes.prepend(n);
    while (notes.children.length > 6) notes.lastChild.remove();
  }

  anchor(target) {
    const floor = this.root.querySelector(".floor");
    const node = target === "board" ? this.root.querySelector("[data-board]") : this.el(target)?.querySelector(".screen");
    if (!node) return null;
    const fr = floor.getBoundingClientRect();
    const r = node.getBoundingClientRect();
    return { x: r.left - fr.left + r.width / 2, y: r.top - fr.top + r.height / 2 };
  }

  // Un oggetto (foglio, messaggio, post-it, documento revisionato) vola da un ufficio all'altro
  fly(from, to, kind = "paper", label = "", delay = 0) {
    if (this.instant || !from || !to || from === to) return Promise.resolve();
    return new Promise((resolve) => {
      setTimeout(() => {
        const a = this.anchor(from);
        const b = this.anchor(to);
        if (!a || !b) { resolve(); return; }
        const layer = this.root.querySelector("[data-fly]");
        const el = document.createElement("div");
        el.className = `fly fly-${kind}`;
        const color = (this.agents[from] || this.agents[to] || {}).color || "#7c5cff";
        el.style.setProperty("--c", color);
        el.innerHTML = kind === "msg" ? "<span>…</span>" : kind === "ok" ? "<span>✓</span>" : kind === "ko" ? "<span>✕</span>" : `<i></i><i></i><i></i>${label ? `<em>${esc(label)}</em>` : ""}`;
        layer.appendChild(el);
        const midX = (a.x + b.x) / 2;
        const midY = Math.min(a.y, b.y) - 50;
        const anim = el.animate([
          { transform: `translate(${a.x}px, ${a.y}px) translate(-50%, -50%) scale(.4) rotate(-10deg)`, opacity: 0 },
          { transform: `translate(${a.x}px, ${a.y}px) translate(-50%, -50%) scale(1) rotate(0deg)`, opacity: 1, offset: 0.12 },
          { transform: `translate(${midX}px, ${midY}px) translate(-50%, -50%) scale(1.15) rotate(8deg)`, opacity: 1, offset: 0.55 },
          { transform: `translate(${b.x}px, ${b.y}px) translate(-50%, -50%) scale(.85) rotate(0deg)`, opacity: 1, offset: 0.9 },
          { transform: `translate(${b.x}px, ${b.y}px) translate(-50%, -50%) scale(.3)`, opacity: 0 },
        ], { duration: 1100, easing: "cubic-bezier(.45,.05,.35,1)" });
        anim.onfinish = () => {
          el.remove();
          const target = to === "board" ? this.root.querySelector("[data-board]") : this.el(to);
          target?.classList.add("receive");
          setTimeout(() => target?.classList.remove("receive"), 500);
          resolve();
        };
      }, delay);
    });
  }

  alert(el) { this.root.querySelector("[data-alerts]").appendChild(el); }

  celebrate() {
    if (this.instant) return;
    const floor = this.root.querySelector(".floor");
    const colors = Object.values(this.agents).map((a) => a.color);
    for (let i = 0; i < 40; i++) {
      const c = document.createElement("i");
      c.className = "confetti";
      c.style.left = `${Math.random() * 100}%`;
      c.style.background = colors[i % colors.length];
      c.style.animationDelay = `${Math.random() * 0.4}s`;
      c.style.setProperty("--dx", `${(Math.random() - 0.5) * 120}px`);
      floor.appendChild(c);
      setTimeout(() => c.remove(), 2200);
    }
  }
}
