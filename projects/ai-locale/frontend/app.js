import { applyI18n, getLang, setLang, t } from "./i18n.js";
import { esc, renderMarkdown } from "./markdown.js";
import { Office } from "./office.js";

// L'ufficio 3D (three.js, ~2 MB) si carica solo quando serve
let office3dModule = null;
const offices = () => [state.office, state.office3d].filter(Boolean);
const office3dOpts = { onFull: () => { document.querySelector(".chat-layout").classList.toggle("office-full"); document.querySelector(".chat-layout").classList.remove("room-hidden"); } };

// ---------------------------------------------------------------------------
// Stato e utilità
// ---------------------------------------------------------------------------
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const state = {
  me: null, agents: {}, conversations: [], currentId: null, view: "chat",
  runId: null, source: null, collections: [], selected: new Set(), assistantEl: null, answer: "",
  agentStatus: {}, sysTimer: null, settingsMeta: null, office: null, rejected: {}, helpPending: {}, attachments: [],
};

const store = {
  get(k, d) { try { return localStorage.getItem(k) ?? d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* storage non disponibile */ } },
};

async function api(path, opts = {}) {
  const headers = { "X-AILocale": "1", ...(opts.headers || {}) };
  let body = opts.body;
  if (body && !(body instanceof FormData)) { headers["Content-Type"] = "application/json"; body = JSON.stringify(body); }
  const res = await fetch(path, { method: opts.method || "GET", headers, body, credentials: "same-origin" });
  let data = null;
  try { data = await res.json(); } catch { /* risposta vuota */ }
  if (res.status === 401 && !path.startsWith("/api/login")) { showLogin(); }
  if (!res.ok) { const err = new Error((data && (data.detail || data.error)) || res.statusText); err.status = res.status; err.data = data; throw err; }
  return data;
}

function toast(msg, bad = false) {
  const el = $("#toast");
  el.textContent = msg;
  el.classList.toggle("bad", bad);
  el.classList.add("show");
  clearTimeout(toast._t);
  toast._t = setTimeout(() => el.classList.remove("show"), 2600);
}

const fmtBytes = (n) => {
  if (n == null) return "–";
  const u = ["B", "KB", "MB", "GB", "TB"]; let i = 0; let v = n;
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(v < 10 && i ? 1 : 0)} ${u[i]}`;
};
const fmtDate = (ts) => new Date(ts * 1000).toLocaleString(getLang() === "it" ? "it-IT" : "en-GB", { dateStyle: "short", timeStyle: "short" });
const initials = (name) => name.slice(0, 2).toUpperCase();
const agent = (id) => state.agents[id] || { id, name: id, color: "#888" };

// ---------------------------------------------------------------------------
// Tema, lingua, navigazione
// ---------------------------------------------------------------------------
function setTheme(theme) {
  const changed = document.documentElement.dataset.theme !== theme;
  document.documentElement.dataset.theme = theme;
  if (changed && state.office3d) {
    state.office3d.dispose();
    state.office3d = new office3dModule.Office3D($("#office3d"), state.agents, t, office3dOpts);
  }
  store.set("ailocale.theme", theme);
  $$("#themeSeg button").forEach((b) => b.classList.toggle("on", b.dataset.themeVal === theme));
}

function refreshLangUI() {
  applyI18n();
  $$("#langSeg button").forEach((b) => b.classList.toggle("on", b.dataset.lang === getLang()));
  renderSuggestions();
  renderRoster();
  offices().forEach((o) => o.render());
  if (state.view === "settings") loadSettings();
}

function showView(view) {
  state.view = view;
  $$(".view").forEach((v) => v.classList.toggle("active", v.id === `view-${view}`));
  $$("#mainNav button").forEach((b) => b.classList.toggle("active", b.dataset.view === view));
  $("#sidebar").classList.remove("open");
  clearInterval(state.sysTimer);
  if (view === "documents") loadDocuments();
  if (view === "memory") loadMemory();
  if (view === "settings") loadSettings();
  if (view === "tools") loadTools();
  if (view === "system") { loadSystem(true); state.sysTimer = setInterval(() => loadSystem(false), 3000); }
}

// ---------------------------------------------------------------------------
// Conversazioni
// ---------------------------------------------------------------------------
async function loadConversations() {
  const q = $("#convSearch").value.trim();
  const data = await api(`/api/conversations${q ? `?q=${encodeURIComponent(q)}` : ""}`);
  state.conversations = data.items;
  const list = $("#convList");
  list.innerHTML = "";
  for (const c of data.items) {
    const el = document.createElement("div");
    el.className = `conv-item${c.id === state.currentId ? " active" : ""}`;
    el.innerHTML = `<span class="t">${esc(c.title)}</span><button class="x" title="✕">✕</button>`;
    el.addEventListener("click", () => openConversation(c.id));
    el.addEventListener("dblclick", () => renameConversation(c));
    $(".x", el).addEventListener("click", async (e) => {
      e.stopPropagation();
      if (!confirm(t("deleteConfirm"))) return;
      try {
        await api(`/api/conversations/${c.id}`, { method: "DELETE" });
        if (state.currentId === c.id) newConversation();
        loadConversations();
      } catch (err) { toast(err.message, true); }
    });
    list.appendChild(el);
  }
}

async function renameConversation(c) {
  const title = prompt("Titolo / Title", c.title);
  if (!title) return;
  await api(`/api/conversations/${c.id}`, { method: "PATCH", body: { title } });
  if (c.id === state.currentId) $("#convTitle").textContent = title;
  loadConversations();
}

function newConversation() {
  closeStream();
  state.currentId = null;
  $("#convTitle").textContent = t("newChat");
  $("#messages").innerHTML = "";
  showEmpty();
  resetRoom();
  setBusy(false);
  showView("chat");
  loadConversations();
  $("#input").focus();
}

let emptyTpl = null;
function showEmpty() {
  const box = $("#messages");
  box.appendChild(emptyTpl.cloneNode(true));
  applyI18n(box);
  renderSuggestions();
}

async function openConversation(id) {
  closeStream();
  showView("chat");
  const conv = await api(`/api/conversations/${id}`);
  state.currentId = id;
  $("#convTitle").textContent = conv.title;
  const box = $("#messages");
  box.innerHTML = "";
  if (!conv.messages.length) showEmpty();
  for (const m of conv.messages) addMessage(m.role, m.content, m.attachments || []);
  resetRoom();
  loadConversations();
  const lastRun = [...conv.messages].reverse().find((m) => m.run_id)?.run_id;
  if (lastRun) {
    const run = await api(`/api/runs/${lastRun}`).catch(() => null);
    if (run && run.status === "running") { attachRun(lastRun, true); }
    else if (run) { for (const ev of run.events) handleEvent(ev, true); }
  }
  scrollBottom(true);
}

// ---------------------------------------------------------------------------
// Messaggi
// ---------------------------------------------------------------------------
function addMessage(role, content, attachments = []) {
  $("#emptyState")?.remove();
  const el = document.createElement("div");
  el.className = `msg ${role}`;
  if (role === "user") {
    el.innerHTML = `<div class="bubble"></div>`;
    $(".bubble", el).textContent = content;
    if (attachments.length) {
      $(".bubble", el).insertAdjacentHTML("afterbegin", `<div class="msg-images">${attachments.map((a) => `<img src="/api/uploads/${encodeURIComponent(a.split("/").pop())}" alt="">`).join("")}</div>`);
    }
  } else {
    el.innerHTML = `<div class="avatar">AI</div><div class="bubble"></div>`;
    $(".bubble", el).innerHTML = renderMarkdown(content);
  }
  $("#messages").appendChild(el);
  return el;
}

function scrollBottom(force = false) {
  const box = $("#messages");
  if (force || box.scrollHeight - box.scrollTop - box.clientHeight < 160) box.scrollTop = box.scrollHeight;
}

function setBusy(busy) {
  $("#sendBtn").classList.toggle("hidden", busy);
  $("#stopBtn").classList.toggle("hidden", !busy);
  $("#input").disabled = false;
}

async function send(text) {
  text = text.trim();
  if (!text || state.runId) return;
  try {
    if (!state.currentId) {
      const c = await api("/api/conversations", { method: "POST", body: {} });
      state.currentId = c.id;
    }
    const attachments = state.attachments.map((a) => a.name);
    addMessage("user", text, state.attachments.map((a) => a.path));
    $("#input").value = "";
    state.attachments = [];
    renderAttachments();
    autoGrow();
    scrollBottom(true);
    const { run_id: runId } = await api(`/api/conversations/${state.currentId}/messages`, {
      method: "POST", body: { content: text, collections: [...state.selected], attachments },
    });
    resetRoom();
    attachRun(runId, false);
    await loadConversations();
    const conv = state.conversations.find((c) => c.id === state.currentId);
    if (conv) $("#convTitle").textContent = conv.title;
  } catch (err) {
    toast(err.status === 409 ? t("busy") : err.message, true);
  }
}

function attachRun(runId, replayOnly) {
  state.runId = runId;
  state.answer = "";
  state.assistantEl = addMessage("assistant", "");
  $(".bubble", state.assistantEl).innerHTML = `<span class="working"><i></i><i></i><i></i> ${t("thinking")}</span>`;
  setBusy(true);
  const es = new EventSource(`/api/runs/${runId}/events`);
  state.source = es;
  es.onmessage = (msg) => {
    const ev = JSON.parse(msg.data);
    if (ev.type === "stream_end") { closeStream(); return; }
    handleEvent(ev, false);
  };
  es.onerror = () => { if (state.source === es && es.readyState === EventSource.CLOSED) closeStream(); };
}

function closeStream() {
  if (state.source) { state.source.close(); state.source = null; }
  state.runId = null;
  setBusy(false);
}

// ---------------------------------------------------------------------------
// Stanza degli agenti
// ---------------------------------------------------------------------------
function renderRoster() {
  const box = $("#roster");
  box.innerHTML = "";
  for (const a of Object.values(state.agents)) {
    const st = state.agentStatus[a.id] || "";
    const el = document.createElement("div");
    el.className = `agent ${st.startsWith("busy") ? "busy" : st === "done" ? "done" : ""}`;
    el.style.setProperty("--c", a.color);
    el.title = a.description;
    el.innerHTML = `<div class="av" style="background:${a.color}">${initials(a.name)}</div><div>${esc(a.name)}</div><div class="st">${esc(st.startsWith("busy:") ? st.slice(5) : "")}</div>`;
    box.appendChild(el);
  }
}

function setAgent(id, status) { state.agentStatus[id] = status; renderRoster(); }

function resetRoom() {
  state.agentStatus = {};
  offices().forEach((o) => o.reset());
  renderRoster();
  $("#timeline").innerHTML = `<p class="muted small">${t("roomEmpty")}</p>`;
  $("#roomStats").textContent = "";
}

function tl(agentId, html, cls = "") {
  const tlBox = $("#timeline");
  if (tlBox.firstElementChild?.tagName === "P") tlBox.innerHTML = "";
  const a = agent(agentId);
  const el = document.createElement("div");
  el.className = `ev ${cls}`;
  el.style.setProperty("--c", a.color);
  el.innerHTML = html;
  tlBox.appendChild(el);
  tlBox.scrollTop = tlBox.scrollHeight;
  return el;
}

const who = (id) => `<span class="who">${esc(agent(id).name)}</span>`;
const agentTag = (id) => `<span class="tag agent-tag" style="--c:${agent(id).color}">${esc(agent(id).name)}</span>`;

function handleEvent(ev, replay) {
  const d = ev.data || {};
  for (const o of offices()) {
    o.instant = replay;
    try { officeEvent(o, ev.type, d); } catch (err) { console.error(err); }
  }
  switch (ev.type) {
    case "planning":
      setAgent("coordinatore", `busy:${t("planning")}`);
      break;
    case "plan": {
      setAgent("coordinatore", "done");
      const items = d.direct ? `<div class="body">${t("directAnswer")}</div>`
        : `<ul class="plan-list">${d.tasks.map((x) => `<li><span class="tag">${esc(x.id)}</span>${agentTag(x.agent)} <span>${esc(x.goal)}</span>${x.depends_on.length ? ` <span class="tag">← ${esc(x.depends_on.join(", "))}</span>` : ""}</li>`).join("")}</ul>`;
      tl("coordinatore", `${who("coordinatore")} <span class="what">· ${t("plan")}</span>${d.reasoning ? `<div class="body muted">${esc(d.reasoning)}</div>` : ""}${items}`);
      break;
    }
    case "task_started":
      setAgent(d.agent, `busy:${d.task_id}`);
      tl(d.agent, `${who(d.agent)} <span class="what">${t("taskStart")} ${esc(d.task_id)}${d.attempt > 1 ? ` · ${t("revision")} ${d.attempt - 1}` : ""}</span><div class="body">${esc(d.goal)}</div>${d.feedback ? `<details><summary>feedback</summary><pre>${esc(d.feedback)}</pre></details>` : ""}`);
      break;
    case "tool_call":
      setAgent(d.agent, `busy:${d.tool}`);
      tl(d.agent, `${who(d.agent)} <span class="what">${t("toolCall")}</span> <span class="tag">${esc(d.tool)}</span><details><summary>args</summary><pre>${esc(JSON.stringify(d.args, null, 2))}</pre></details>`).dataset.call = d.call_id;
      break;
    case "tool_result":
      tl(d.agent, `${who(d.agent)} <span class="what">${t("toolResult")}</span> <span class="tag">${esc(d.tool)}</span> <span class="tag ${d.ok ? "ok" : "bad"}">${d.ok ? "ok" : "✕"}</span><details><summary>output</summary><pre>${esc(d.output)}</pre></details>`);
      break;
    case "approval_required": {
      const html = `${who(d.agent)} <span class="what">· ${t("approvalNeeded")}</span> <span class="tag">${esc(d.tool)}</span><pre>${esc(d.preview)}</pre><div class="actions"><button class="btn small primary" data-a="1">${t("approve")}</button><button class="btn small" data-a="0">${t("deny")}</button></div>`;
      const el = tl(d.agent, html, "approval");
      el.dataset.approval = d.approval_id;
      const cards = [el];
      if (!replay) {
        for (const o of offices()) {
          const oc = document.createElement("div");
          oc.className = "ev approval";
          oc.style.setProperty("--c", agent(d.agent).color);
          oc.dataset.approval = d.approval_id;
          oc.innerHTML = html;
          o.alert(oc);
          cards.push(oc);
        }
      }
      if (!replay) {
        cards.forEach((card) => $$("button", card).forEach((b) => b.addEventListener("click", async () => {
          $$(`[data-approval="${d.approval_id}"] button`).forEach((x) => { x.disabled = true; });
          try { await api(`/api/approvals/${d.approval_id}`, { method: "POST", body: { approve: b.dataset.a === "1" } }); }
          catch (err) { toast(err.message, true); }
        })));
        if ($(".chat-layout").classList.contains("room-hidden")) $(".chat-layout").classList.remove("room-hidden");
      } else { $(".actions", el)?.remove(); }
      break;
    }
    case "approval_resolved": {
      $$(`[data-approval="${d.approval_id}"]`).forEach((el) => {
        if (el.closest(".office-alerts")) { el.remove(); return; }
        $(".actions", el)?.remove();
        el.insertAdjacentHTML("beforeend", `<div class="body"><span class="tag ${d.approved ? "ok" : "bad"}">${d.approved ? t("approvedLbl") : t("deniedLbl")}${d.reason ? ` (${esc(d.reason)})` : ""}</span></div>`);
      });
      break;
    }
    case "consult":
      setAgent(d.target, `busy:${t("replies")}`);
      tl(d.source, `${who(d.source)} <span class="what">${t("consults")}</span> ${agentTag(d.target)}<div class="body">${esc(d.question)}</div>`);
      break;
    case "consult_reply":
      setAgent(d.source, "done");
      tl(d.source, `${who(d.source)} <span class="what">${t("replies")}</span> ${agentTag(d.target)}<details><summary>…</summary><div class="body">${esc(d.answer)}</div></details>`);
      break;
    case "note":
      tl(d.agent, `${who(d.agent)} <span class="what">· ${t("note")}</span><div class="body">${esc(d.text)}</div>`);
      break;
    case "reviewing":
      setAgent("critico", `busy:${d.target}`);
      break;
    case "review":
      setAgent("critico", "done");
      tl("critico", `${who("critico")} <span class="what">→</span> ${agentTag(d.target)} <span class="tag ${d.approved ? "ok" : "bad"}">${d.approved ? t("approved") : t("rejected")}${d.score != null ? ` · ${d.score}/10` : ""}</span>${d.issues?.length ? `<div class="body">${d.issues.map((x) => `• ${esc(x)}`).join("\n")}</div>` : ""}`);
      break;
    case "task_finished":
      setAgent(d.agent, "done");
      tl(d.agent, `${who(d.agent)} <span class="what">${t("taskDone")} ${esc(d.task_id)} · ${d.seconds}${t("seconds")}</span><details><summary>${t("toolResult")}</summary><div class="body">${esc(d.result)}</div></details>`);
      break;
    case "task_failed":
      setAgent(d.agent, "done");
      tl(d.agent, `${who(d.agent)} <span class="tag bad">✕</span> <span class="what">${esc(d.error)}</span>`, "error");
      break;
    case "synthesis_started":
      setAgent("coordinatore", `busy:${t("synthesis")}`);
      if (!replay && state.assistantEl) { $(".bubble", state.assistantEl).innerHTML = ""; $(".bubble", state.assistantEl).classList.add("cursor"); }
      break;
    case "token":
      if (!replay && state.assistantEl) {
        state.answer += d.text;
        const b = $(".bubble", state.assistantEl);
        b.innerHTML = renderMarkdown(state.answer);
        scrollBottom();
      }
      break;
    case "final":
      setAgent("coordinatore", "done");
      if (!replay && state.assistantEl) {
        const b = $(".bubble", state.assistantEl);
        b.classList.remove("cursor");
        b.innerHTML = renderMarkdown(d.content);
        if (d.sources?.length) b.insertAdjacentHTML("beforeend", `<div class="sources">${d.sources.map((s) => s.url ? `<a class="source" href="${esc(s.url)}" target="_blank" rel="noopener noreferrer">${esc(s.filename)}</a>` : `<span class="source">${esc(s.filename)}${s.page ? `, p. ${s.page}` : ""}</span>`).join("")}</div>`);
        scrollBottom();
      }
      break;
    case "error":
      if (!replay && state.assistantEl) {
        const b = $(".bubble", state.assistantEl);
        b.classList.remove("cursor");
        b.innerHTML = renderMarkdown(`**[${d.status === "cancelled" ? t("cancelled") : t("runFailed")}]** ${d.message}`);
      }
      tl("coordinatore", `<span class="tag bad">${esc(d.status)}</span> <span class="what">${esc(d.message)}</span>`, "error");
      break;
    case "run_finished": {
      Object.keys(state.agentStatus).forEach((k) => { if (state.agentStatus[k].startsWith("busy")) state.agentStatus[k] = "done"; });
      renderRoster();
      const s = d.stats || {};
      const stats = `${s.seconds ?? "–"}${t("seconds")} · ${s.llm_calls ?? 0} ${t("calls")} · ${s.tool_calls ?? 0} ${t("tools")}${s.tokens_per_second ? ` · ${s.tokens_per_second} ${t("tokS")}` : ""}`;
      $("#roomStats").textContent = stats;
      if (!replay && state.assistantEl) state.assistantEl.querySelector(".bubble").insertAdjacentHTML("beforeend", `<div class="msg-meta">${esc(stats)}</div>`);
      break;
    }
    default: break;
  }
}

// ---------------------------------------------------------------------------
// Ufficio animato: traduce gli eventi reali del motore in azioni visibili
// ---------------------------------------------------------------------------
const short = (s, n = 60) => (s || "").replace(/\s+/g, " ").trim().slice(0, n) + ((s || "").length > n ? "…" : "");
const toolLabel = (tool, args = {}) => {
  const a = args || {};
  switch (tool) {
    case "search_documents": return `${t("doSearch")}: ${short(a.query, 40)}`;
    case "read_file": return `${t("doRead")} ${short(a.path, 30)}`;
    case "list_files": return t("doList");
    case "write_file": return `${t("doWrite")} ${short(a.path, 30)}`;
    case "run_python": return t("doPython");
    case "run_command": return `${t("doCommand")}: ${short(a.command, 30)}`;
    case "recall_memory": return t("doRecall");
    case "remember": return t("doRemember");
    case "note": return t("doNote");
    case "ask_agent": return a.agent ? `${t("consults")} ${agent(a.agent).name}` : t("doConsult");
    default: return tool;
  }
};

function officeEvent(o, type, d) {
  o.hp = o.hp || {};
  switch (type) {
    case "run_started":
      o.hp = {};
      o.reset();
      o.setJob(d.message);
      break;
    case "planning":
      o.set("coordinatore", "thinking", { bubble: t("bubblePlan") });
      break;
    case "plan":
      if (d.direct) { o.set("coordinatore", "writing", { text: t("directAnswer") }); break; }
      o.setTasks(d.tasks);
      if (d.tasks.length >= 2) o.meeting?.(["coordinatore", ...new Set(d.tasks.map((x) => x.agent))]);
      o.set("coordinatore", "working", { tool: "note", text: `${d.tasks.length} ${t("tasksAssigned")}`, bubble: short(d.reasoning, 80) || null });
      d.tasks.forEach((task, i) => {
        o.setAfter(o.fly("coordinatore", task.agent, "paper", task.id, 500 + i * 320), task.agent, "assigned",
          { label: task.id, text: `${task.id}: ${short(task.goal, 50)}` });
      });
      break;
    case "task_started":
      o.goHome?.(d.agent);
      if (d.attempt === 1) o.goHome?.("coordinatore");
      o.set(d.agent, "thinking", { text: `${d.task_id}${d.attempt > 1 ? ` · ${t("revision")} ${d.attempt - 1}` : ""}: ${short(d.goal, 50)}`, bubble: d.attempt > 1 ? t("bubbleFix") : short(d.goal, 70) });
      if (d.attempt === 1) o.set("coordinatore", "idle", { text: t("st_supervising") });
      break;
    case "tool_call":
      o.set(d.agent, "working", { tool: d.tool, text: toolLabel(d.tool, d.args), bubble: toolLabel(d.tool, d.args) });
      break;
    case "tool_result":
      if (!d.ok) o.set(d.agent, "thinking", { text: `${toolLabel(d.tool)} ✕`, bubble: t("bubbleRetry") });
      else o.set(d.agent, "writing", { text: `${toolLabel(d.tool)} ✓` });
      break;
    case "approval_required":
      o.set(d.agent, "waiting", { text: `${t("approvalNeeded")}: ${d.tool}`, bubble: t("bubbleApproval") });
      break;
    case "approval_resolved":
      break;
    case "consult":
      o.set(d.source, "asking", { text: `${t("consults")} ${agent(d.target).name}`, bubble: short(d.question, 70) });
      o.hp[d.target] = (o.hp[d.target] || 0) + 1;
      o.visit?.(d.source, d.target);
      o.fly(d.source, d.target, "msg").then(() => {
        if (o.hp[d.target] > 0) o.startHelping(d.target, { text: `${t("helps")} ${agent(d.source).name}`, bubble: t("bubbleHelp") });
      });
      break;
    case "consult_reply":
      o.hp[d.source] = Math.max(0, (o.hp[d.source] || 0) - 1);
      o.stopHelping(d.source);
      setTimeout(() => o.goHome?.(d.target), 900);
      o.setAfter(o.fly(d.source, d.target, "msg"), d.target, "thinking", { text: t("gotHelp"), bubble: short(d.answer, 70) });
      break;
    case "note":
      o.fly(d.agent, "board", "note").then(() => o.pin(d.agent, d.text));
      break;
    case "reviewing":
      o.visit?.(d.target, "critico");
      o.setAfter(o.fly(d.target, "critico", "paper"), "critico", "reviewing", { text: `${t("reviews")} ${agent(d.target).name}`, bubble: t("bubbleReview") });
      o.set(d.target, "idle", { text: t("st_inReview") });
      break;
    case "review":
      o.set("critico", d.approved ? "done" : "error", { text: `${agent(d.target).name}: ${d.approved ? t("approved") : t("rejected")}${d.score != null ? ` ${d.score}/10` : ""}`, bubble: d.approved ? null : short((d.issues || [])[0], 70) });
      o.fly("critico", d.target, d.approved ? "ok" : "ko").then(() => o.goHome?.(d.target));
      if (!d.approved) state.rejected[d.task_id] = true;
      break;
    case "task_finished":
      o.finishTask(d.task_id);
      o.set(d.agent, "done", { text: `${d.task_id} ${t("delivered")} · ${d.seconds}s` });
      o.fly(d.agent, "board", "paper", d.task_id).then(() => o.pin(d.agent, `${d.task_id} ✓ ${short(d.result, 60)}`));
      break;
    case "task_failed":
      o.set(d.agent, "error", { text: short(d.error, 60) });
      break;
    case "synthesis_started":
      o.fly("board", "coordinatore", "paper");
      o.set("coordinatore", "writing", { text: t("synthesis"), bubble: t("bubbleSynth") });
      o.goHome?.("coordinatore");
      Object.keys(o.agents).forEach((id) => { if (id !== "coordinatore" && o.stateOf(id) === "reviewing") o.set(id, "idle"); });
      break;
    case "final":
      o.set("coordinatore", "done", { text: t("delivered") });
      o.celebrate();
      break;
    case "error":
      o.set("coordinatore", "error", { text: short(d.message, 70), bubble: d.status === "cancelled" ? t("cancelled") : t("runFailed") });
      break;
    case "run_finished":
      o.stopClock(d.stats?.seconds);
      Object.keys(o.agents).forEach((id) => {
        if (!["done", "error", "idle"].includes(o.stateOf(id))) o.set(id, "idle");
        setTimeout(() => o.goHome?.(id), 1500);
      });
      break;
    default: break;
  }
}

async function ensureOffice3d() {
  if (state.office3d) return state.office3d;
  if (!office3dModule) office3dModule = await import("./office3d.js");
  if (!office3dModule.webglAvailable()) return null;
  state.office3d = new office3dModule.Office3D($("#office3d"), state.agents, t, office3dOpts);
  return state.office3d;
}

async function setRoomTab(tab) {
  if (tab === "office3d") {
    try {
      if (!(await ensureOffice3d())) { toast(t("no3d"), true); tab = "office"; }
    } catch (err) { console.error(err); toast(t("no3d"), true); tab = "office"; }
  }
  $$("#roomTabs button").forEach((b) => b.classList.toggle("on", b.dataset.tab === tab));
  $("#pane-office3d").classList.toggle("active", tab === "office3d");
  $("#pane-office").classList.toggle("active", tab === "office");
  $("#pane-log").classList.toggle("active", tab === "log");
  store.set("ailocale.roomTab", tab);
}

// ---------------------------------------------------------------------------
// Composer
// ---------------------------------------------------------------------------
function autoGrow() {
  const ta = $("#input");
  ta.style.height = "auto";
  ta.style.height = `${Math.min(220, ta.scrollHeight)}px`;
}

function renderAttachments() {
  const box = $("#attachPreview");
  box.innerHTML = "";
  state.attachments.forEach((a, i) => {
    const d = document.createElement("div");
    d.className = "att";
    d.innerHTML = `<img src="/api/uploads/${encodeURIComponent(a.name)}" alt=""><button type="button" title="✕">✕</button>`;
    $("button", d).addEventListener("click", () => { state.attachments.splice(i, 1); renderAttachments(); });
    box.appendChild(d);
  });
}

async function attachFiles(files) {
  for (const f of files) {
    if (state.attachments.length >= 6) break;
    const fd = new FormData();
    fd.append("file", f);
    try { state.attachments.push(await api("/api/uploads", { method: "POST", body: fd })); }
    catch (err) { toast(`${f.name}: ${err.message}`, true); }
  }
  renderAttachments();
}

// ---------------------------------------------------------------------------
// Strumenti
// ---------------------------------------------------------------------------
async function loadTools() {
  const data = await api("/api/tools");
  const c = data.capabilities;
  const cap = (k, ok, detail) => `<div class="cap ${ok ? "on" : "off"}"><span class="dot ${ok ? "ok" : "bad"}"></span><div><b>${t(`cap_${k}`)}</b><div class="muted small">${esc(detail)}</div></div></div>`;
  $("#caps").innerHTML = [
    cap("web", c.web, c.web ? t("capWebOn") : t("capWebOff")),
    cap("browser", c.browser, c.browser ? "Playwright + Chromium" : t("capBrowserOff")),
    cap("vision", c.vision, c.vision ? t("capVisionOn") : t("capVisionOff")),
    cap("ocr", Boolean(c.ocr), c.ocr ? (c.ocr === "tesseract" ? "Tesseract" : t("capVisionOn")) : t("capOcrOff")),
  ].join("");
  const riskCls = { read: "", write: "warn", exec: "bad", network: "", external: "bad" };
  $("#toolsTable").innerHTML = `<thead><tr><th>${t("tool")}</th><th>${t("risk")}</th><th>${t("approvalCol")}</th><th>${t("agentsCol")}</th><th></th></tr></thead><tbody>${data.items.map((x) => `<tr class="${x.enabled ? "" : "disabled"}"><td><code>${esc(x.name)}</code><div class="muted small">${esc(x.description)}</div></td><td><span class="tag ${riskCls[x.risk]}">${t(`risk_${x.risk}`)}</span></td><td class="small">${esc(x.approval)}</td><td>${x.agents.map((a) => agentTag(a)).join(" ")}</td><td>${x.enabled ? `<span class="tag ok">${t("active")}</span>` : `<span class="tag">${t("inactive")}</span>`}</td></tr>`).join("")}</tbody>`;
  $("#roots").innerHTML = data.roots.map((r, i) => `<li><code>${esc(r)}</code>${i === 0 ? ` <span class="muted small">(${t("workspace")})</span>` : ""}</li>`).join("");
}

async function loadAudit() {
  const data = await api("/api/admin/audit");
  $("#audit").innerHTML = data.items.length ? `<tbody>${data.items.slice(0, 80).map((a) => `<tr><td class="small muted">${fmtDate(a.ts)}</td><td>${agentTag(a.agent)}</td><td><code>${esc(a.tool)}</code></td><td class="small muted">${esc((a.args || "").slice(0, 120))}</td><td>${a.ok ? `<span class="tag ok">ok</span>` : `<span class="tag bad" title="${esc(a.error || "")}">✕</span>`}</td></tr>`).join("")}</tbody>` : `<tr><td class="muted small">—</td></tr>`;
}

function renderSuggestions() {
  const box = $("#suggestions");
  if (!box) return;
  box.innerHTML = "";
  ["sugg1", "sugg2", "sugg3", "sugg4"].forEach((k) => {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = t(k);
    b.addEventListener("click", () => send(t(k)));
    box.appendChild(b);
  });
}

async function loadCollections() {
  try {
    const data = await api("/api/documents");
    state.collections = data.collections;
  } catch { state.collections = []; }
  const box = $("#collectionChips");
  box.innerHTML = "";
  if (!state.collections.length) return;
  box.insertAdjacentHTML("beforeend", `<span class="chip-label">${t("useDocs")}</span>`);
  for (const c of state.collections) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = `chip${state.selected.has(c) ? " on" : ""}`;
    b.textContent = c;
    b.addEventListener("click", () => {
      if (state.selected.has(c)) state.selected.delete(c); else state.selected.add(c);
      b.classList.toggle("on");
    });
    box.appendChild(b);
  }
}

// ---------------------------------------------------------------------------
// Documenti
// ---------------------------------------------------------------------------
async function loadDocuments() {
  const data = await api("/api/documents");
  $("#uploadHint").textContent = `${data.allowed_extensions.join(" ")} · max ${data.max_upload_mb} MB`;
  const tbl = $("#docTable");
  if (!data.items.length) { tbl.innerHTML = `<tr><td class="muted">${t("noDocs")}</td></tr>`; return; }
  tbl.innerHTML = `<thead><tr><th>${t("file")}</th><th>${t("collection")}</th><th>${t("pages")}</th><th>${t("chunks")}</th><th>${t("embedding")}</th><th>${t("size")}</th><th>${t("date")}</th><th></th></tr></thead><tbody>${data.items.map((d) => `<tr><td>${esc(d.filename)}</td><td><span class="tag">${esc(d.collection)}</span></td><td>${d.pages ?? "–"}</td><td>${d.chunks}</td><td>${d.embedded ? `<span class="tag ok">${t("yes")}</span>` : `<span class="tag">${t("no")}</span>`}</td><td>${fmtBytes(d.size)}</td><td>${fmtDate(d.created_at)}</td><td><button class="btn small ghost" data-del="${d.id}">✕</button></td></tr>`).join("")}</tbody>`;
  $$("[data-del]", tbl).forEach((b) => b.addEventListener("click", async () => {
    if (!confirm(t("deleteDoc"))) return;
    await api(`/api/documents/${b.dataset.del}`, { method: "DELETE" });
    loadDocuments(); loadCollections();
  }));
}

async function uploadFiles(files) {
  const log = $("#uploadLog");
  for (const f of files) {
    const line = document.createElement("div");
    line.textContent = `⏳ ${f.name}`;
    log.prepend(line);
    const fd = new FormData();
    fd.append("file", f);
    fd.append("collection", $("#docCollection").value || "generale");
    try {
      const r = await api("/api/documents", { method: "POST", body: fd });
      line.textContent = `✓ ${f.name} · ${r.chunks} ${t("chunks").toLowerCase()}${r.unchanged ? " (=)" : ""}${r.embedded ? "" : ` · ${t("no")}`}`;
    } catch (err) { line.textContent = `✕ ${f.name}: ${err.message}`; line.className = "error"; }
  }
  loadDocuments(); loadCollections();
}

// ---------------------------------------------------------------------------
// Memoria
// ---------------------------------------------------------------------------
async function loadMemory() {
  const data = await api("/api/memory");
  const ul = $("#memList");
  ul.innerHTML = data.items.length ? "" : `<li class="muted">${t("noMemory")}</li>`;
  for (const m of data.items) {
    const li = document.createElement("li");
    li.innerHTML = `<span class="src">${esc(m.source)}</span><textarea rows="1"></textarea><button class="btn small" data-save>${t("save")}</button><button class="btn small ghost" data-del>✕</button>`;
    $("textarea", li).value = m.content;
    $("[data-save]", li).addEventListener("click", async () => {
      await api(`/api/memory/${m.id}`, { method: "PUT", body: { content: $("textarea", li).value } });
      toast(t("saved"));
    });
    $("[data-del]", li).addEventListener("click", async () => { await api(`/api/memory/${m.id}`, { method: "DELETE" }); loadMemory(); });
    ul.appendChild(li);
  }
}

// ---------------------------------------------------------------------------
// Sistema (solo locale)
// ---------------------------------------------------------------------------
function metricCard(label, value, pct, sub) {
  const cls = pct == null ? "" : pct > 90 ? "bad" : pct > 75 ? "warn" : "";
  return `<div class="metric"><div class="lbl"><span>${label}</span><span>${pct != null ? `${Math.round(pct)}%` : ""}</span></div><div class="val">${value}</div>${pct != null ? `<div class="bar ${cls}"><i style="width:${Math.min(100, pct)}%"></i></div>` : ""}<div class="sub">${sub || ""}</div></div>`;
}

async function loadSystem(full) {
  let data;
  try { data = await api("/api/admin/system"); }
  catch (err) {
    if (err.status === 403) { $("#adminDenied").classList.remove("hidden"); $("#sysContent").classList.add("hidden"); clearInterval(state.sysTimer); }
    return;
  }
  const m = data.metrics;
  const g = m.gpu;
  const gpu0 = g.available ? g.gpus[0] : null;
  $("#metrics").innerHTML = [
    metricCard(t("cpu"), `${m.cpu.percent.toFixed(0)}%`, m.cpu.percent, `${m.cpu.cores_physical ?? "?"}C / ${m.cpu.cores_logical}T`),
    metricCard(t("ram"), fmtBytes(m.ram.used), m.ram.percent, `/ ${fmtBytes(m.ram.total)}`),
    gpu0 ? metricCard(t("gpu"), `${gpu0.util_percent ?? "–"}%`, gpu0.util_percent, `${esc(gpu0.name)}${gpu0.temperature_c != null ? ` · ${gpu0.temperature_c}°C` : ""}${gpu0.power_w != null ? ` · ${Math.round(gpu0.power_w)} W` : ""}`)
      : metricCard(t("gpu"), t("unavailable"), null, esc(g.reason || "")),
    gpu0 ? metricCard(t("vram"), fmtBytes(gpu0.vram_used), (gpu0.vram_used / gpu0.vram_total) * 100, `/ ${fmtBytes(gpu0.vram_total)}${g.driver ? ` · driver ${esc(g.driver)}` : ""}`)
      : metricCard(t("vram"), t("unavailable"), null, ""),
    metricCard(t("disk"), fmtBytes(m.disk.free), m.disk.percent, `${t("free")} / ${fmtBytes(m.disk.total)}`),
  ].join("");
  const s = data.services;
  const svcRow = (n, ok, d) => `<div class="svc"><span class="dot ${ok ? "ok" : "bad"}"></span><span class="n">${n}</span><span class="d">${d}</span></div>`;
  $("#services").innerHTML = [
    svcRow("API", true, `uptime ${Math.round(m.process.uptime_s / 60)} min · RAM ${fmtBytes(m.process.rss)}`),
    svcRow("LLM", s.llm.ok, esc(s.llm.ok ? `${(s.llm.model_path || (s.llm.models || []).join(", ") || s.llm.url).split(/[\\/]/).pop()}${s.llm.n_ctx ? ` · ctx ${s.llm.n_ctx}` : ""}${s.llm.total_slots ? ` · ${s.llm.total_slots} slot` : ""}` : `${s.llm.url} · ${s.llm.error || s.llm.status || ""}`)),
    svcRow("Embeddings", s.embeddings.ok, esc(s.embeddings.ok ? (s.embeddings.model_path || s.embeddings.url).split(/[\\/]/).pop() : `${s.embeddings.url} · ${s.embeddings.error || ""}`)),
    svcRow("Runs", true, `${data.active_runs} ${t("activeRuns")} · ${data.pending_approvals} ${t("pendingApprovals")}`),
  ].join("");
  const db = s.database;
  $("#dbStats").innerHTML = `<dl class="kv"><dt>File</dt><dd>${esc(db.path)}</dd><dt>${t("size")}</dt><dd>${fmtBytes(db.size_bytes)}</dd>${["conversations", "messages", "runs", "memories", "documents", "chunks"].map((k) => `<dt>${k}</dt><dd>${db[k]}</dd>`).join("")}</dl>`;
  $("#sysUpdated").textContent = `${t("updated")} ${new Date().toLocaleTimeString()}`;
  updateStatusPill(s.llm);
  if (full) { loadModels(); loadBackups(); loadErrors(); loadLogs(); loadAudit(); }
}

async function loadModels() {
  const data = await api("/api/admin/models");
  $("#modelsDir").textContent = data.models_dir;
  const box = $("#models");
  let html = data.managed_available ? "" : `<p class="muted small">${t("notManaged")}</p>`;
  if (!data.models.length) html += `<p class="muted small">${t("noModels")}</p>`;
  html += data.models.map((m) => {
    const isChat = data.chat.running && data.chat.model_file === m.file;
    const isEmb = data.embed.running && data.embed.model_file === m.file;
    const btns = data.managed_available
      ? (isChat || isEmb ? `<button class="btn small" data-stop="${isEmb ? "embed" : "chat"}">${t("stopModel")}</button>`
        : `<button class="btn small" data-load="${esc(m.file)}" data-kind="chat">${t("load")} (chat)</button> <button class="btn small ghost" data-load="${esc(m.file)}" data-kind="embed">embed</button>`)
      : "";
    return `<div class="list-row"><span>${esc(m.file)} <span class="muted small">${fmtBytes(m.size)}</span> ${isChat || isEmb ? `<span class="tag ok">${t("running")} · ${isEmb ? "embed" : "chat"}</span>` : ""}</span><span>${btns}</span></div>`;
  }).join("");
  box.innerHTML = html;
  $$("[data-load]", box).forEach((b) => b.addEventListener("click", async () => {
    b.disabled = true;
    try {
      const r = await api("/api/admin/models/load", { method: "POST", body: { file: b.dataset.load, kind: b.dataset.kind } });
      toast(r.warning || "OK", Boolean(r.warning));
    } catch (err) { toast(err.message, true); }
    loadModels();
  }));
  $$("[data-stop]", box).forEach((b) => b.addEventListener("click", async () => {
    await api("/api/admin/models/stop", { method: "POST", body: { kind: b.dataset.stop } });
    loadModels();
  }));
}

async function loadBackups() {
  const data = await api("/api/admin/backups");
  const box = $("#backups");
  box.innerHTML = data.items.length ? data.items.map((b) => `<div class="list-row"><span>${esc(b.name)} <span class="muted small">${fmtBytes(b.size)}</span></span><button class="btn small" data-restore="${esc(b.name)}">${t("restore")}</button></div>`).join("") : `<p class="muted small">${t("noBackups")}</p>`;
  $$("[data-restore]", box).forEach((b) => b.addEventListener("click", async () => {
    if (!confirm(t("restoreConfirm"))) return;
    try { await api("/api/admin/backups/restore", { method: "POST", body: { name: b.dataset.restore, confirm: true } }); toast("OK"); loadBackups(); loadConversations(); }
    catch (err) { toast(err.message, true); }
  }));
}

async function loadErrors() {
  const data = await api("/api/admin/errors");
  $("#errors").innerHTML = data.items.length ? data.items.slice(0, 30).map((e) => `<div class="list-row"><span><span class="tag ${e.level === "ERROR" ? "bad" : ""}">${e.level}</span> ${esc(e.message)}</span><span class="muted small">${fmtDate(e.ts)}</span></div>`).join("") : `<p class="muted small">${t("noErrors")}</p>`;
}

async function loadLogs() {
  const data = await api(`/api/admin/logs?source=${$("#logSource").value}&lines=200`);
  const pre = $("#logs");
  pre.textContent = data.lines.join("\n") || "—";
  pre.scrollTop = pre.scrollHeight;
}

async function updateStatusPill(llm) {
  const pill = $("#llmStatus");
  const dot = $(".dot", pill);
  const txt = $(".txt", pill);
  if (!llm) { dot.className = "dot warn"; txt.textContent = t("llmUnknown"); return; }
  dot.className = `dot ${llm.ok ? "ok" : "bad"}`;
  const name = llm.model_path ? llm.model_path.split(/[\\/]/).pop() : (llm.models || [])[0];
  txt.textContent = llm.ok ? (name || t("llmOk")) : t("llmDown");
  pill.title = llm.url || "";
}

async function pollStatus() {
  if (!state.me?.local) { updateStatusPill(null); return; }
  try { const d = await api("/api/admin/system"); updateStatusPill(d.services.llm); } catch { /* ignora */ }
}

// ---------------------------------------------------------------------------
// Impostazioni
// ---------------------------------------------------------------------------
async function loadSettings() {
  const data = await api("/api/settings");
  state.settingsMeta = data.meta;
  const form = $("#settingsForm");
  form.innerHTML = "";
  for (const [k, meta] of Object.entries(data.meta)) {
    const v = data.values[k];
    const label = document.createElement("label");
    label.textContent = t(`set.${k}`);
    label.htmlFor = `set-${k}`;
    const wrap = document.createElement("div");
    if (meta.type === "bool") {
      wrap.innerHTML = `<label class="switch"><input type="checkbox" id="set-${k}" ${v ? "checked" : ""}><span></span></label>`;
    } else {
      const step = meta.type === "float" ? "0.05" : "1";
      wrap.innerHTML = `<input class="input" type="number" id="set-${k}" min="${meta.min}" max="${meta.max}" step="${step}" value="${v}" style="width:120px"> <span class="hint">${meta.min}–${meta.max}</span>`;
    }
    const hintKey = `hint.${k}`;
    if (t(hintKey) !== hintKey) wrap.insertAdjacentHTML("beforeend", `<div class="hint">${t(hintKey)}</div>`);
    form.append(label, wrap);
  }
  const me = state.me || {};
  $("#remoteInfo").innerHTML = `<p class="small">${me.local ? t("youAreLocal") : t("youAreRemote")} ${me.remote_enabled ? t("remoteOn") : t("remoteOff")}</p>${me.local ? "" : `<button class="btn small" id="logoutBtn">${t("logout")}</button>`}`;
  $("#logoutBtn")?.addEventListener("click", async () => { await api("/api/logout", { method: "POST" }); location.reload(); });
}

async function saveSettings() {
  const body = {};
  for (const [k, meta] of Object.entries(state.settingsMeta || {})) {
    const el = $(`#set-${k}`);
    if (!el) continue;
    body[k] = meta.type === "bool" ? el.checked : Number(el.value);
  }
  try { await api("/api/settings", { method: "PUT", body }); toast(t("saved")); loadSettings(); }
  catch (err) { toast(err.message, true); }
}

// ---------------------------------------------------------------------------
// Login remoto
// ---------------------------------------------------------------------------
function showLogin() { $("#login").classList.remove("hidden"); $("#tokenInput").focus(); }

// ---------------------------------------------------------------------------
// Avvio
// ---------------------------------------------------------------------------
async function init() {
  setTheme(store.get("ailocale.theme", matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark"));
  emptyTpl = $("#emptyState").cloneNode(true);
  refreshLangUI();

  state.me = await api("/api/me");
  if (!state.me.authenticated) { showLogin(); }
  if (!state.me.local) $("#navSystem").classList.add("hidden");

  $("#loginForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    try { await api("/api/login", { method: "POST", body: { token: $("#tokenInput").value } }); location.reload(); }
    catch { $("#loginError").textContent = t("invalidToken"); }
  });
  if (!state.me.authenticated) return;

  const agents = await api("/api/agents");
  agents.items.forEach((a) => { state.agents[a.id] = a; });
  renderRoster();
  state.office = new Office($("#office"), state.agents, t);
  $$("#roomTabs button").forEach((b) => b.addEventListener("click", () => setRoomTab(b.dataset.tab)));
  setRoomTab(store.get("ailocale.roomTab", "office3d"));
  const wide = store.get("ailocale.roomWide", innerWidth >= 1280 ? "1" : "0") === "1";
  $(".chat-layout").classList.toggle("wide", wide);
  $("#expandRoom").addEventListener("click", () => {
    const on = $(".chat-layout").classList.toggle("wide");
    store.set("ailocale.roomWide", on ? "1" : "0");
  });

  $("#newChat").addEventListener("click", newConversation);
  let searchT;
  $("#convSearch").addEventListener("input", () => { clearTimeout(searchT); searchT = setTimeout(loadConversations, 250); });
  $$("#mainNav button").forEach((b) => b.addEventListener("click", () => showView(b.dataset.view)));
  $("#toggleRoom").addEventListener("click", () => $(".chat-layout").classList.toggle("room-hidden"));
  if (innerWidth <= 1100) $(".chat-layout").classList.add("room-hidden");
  $$("#toggleSidebar, [data-toggle-sidebar]").forEach((b) => b.addEventListener("click", () => $("#sidebar").classList.toggle("open")));

  $("#attachInput").addEventListener("change", (e) => { attachFiles([...e.target.files]); e.target.value = ""; });
  $("#input").addEventListener("paste", (e) => {
    const imgs = [...(e.clipboardData?.files || [])].filter((f) => f.type.startsWith("image/"));
    if (imgs.length) { e.preventDefault(); attachFiles(imgs); }
  });
  $(".chat-col").addEventListener("dragover", (e) => e.preventDefault());
  $(".chat-col").addEventListener("drop", (e) => {
    const imgs = [...(e.dataTransfer?.files || [])].filter((f) => f.type.startsWith("image/"));
    if (imgs.length) { e.preventDefault(); attachFiles(imgs); }
  });
  const input = $("#input");
  input.addEventListener("input", autoGrow);
  input.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); send(input.value); } });
  $("#composer").addEventListener("submit", (e) => { e.preventDefault(); send(input.value); });
  $("#stopBtn").addEventListener("click", async () => { if (state.runId) await api(`/api/runs/${state.runId}/cancel`, { method: "POST" }).catch(() => {}); });

  $("#messages").addEventListener("click", (e) => {
    const b = e.target.closest("[data-copy]");
    if (!b) return;
    navigator.clipboard?.writeText(b.closest("pre").querySelector("code").textContent).then(() => toast(t("copied")));
  });

  const dz = $("#dropzone");
  $("#docFile").addEventListener("change", (e) => { uploadFiles([...e.target.files]); e.target.value = ""; });
  ["dragenter", "dragover"].forEach((ev) => dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.add("drag"); }));
  ["dragleave", "drop"].forEach((ev) => dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.remove("drag"); }));
  dz.addEventListener("drop", (e) => uploadFiles([...e.dataTransfer.files]));
  $("#reembedBtn").addEventListener("click", async () => { const r = await api("/api/documents/reembed", { method: "POST" }); toast(`${r.documents} OK`); loadDocuments(); });
  $("#docSearchForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const q = $("#docSearchQ").value.trim();
    if (!q) return;
    const data = await api(`/api/documents/search?q=${encodeURIComponent(q)}`);
    $("#docSearchResults").innerHTML = data.items.length ? data.items.map((h) => `<div class="hit"><div class="h"><span>${esc(h.filename)}${h.page ? `, p. ${h.page}` : ""} · ${esc(h.collection)}</span><span>${h.score.toFixed(3)} · ${h.mode}</span></div><div class="tx">${esc(h.text)}</div></div>`).join("") : `<p class="muted small">${t("noResults")}</p>`;
  });

  $("#memForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const v = $("#memInput").value.trim();
    if (!v) return;
    await api("/api/memory", { method: "POST", body: { content: v } });
    $("#memInput").value = "";
    loadMemory();
  });

  $("#backupBtn").addEventListener("click", async () => { const r = await api("/api/admin/backups", { method: "POST" }); toast(r.created); loadBackups(); });
  $("#logSource").addEventListener("change", loadLogs);
  $$("#themeSeg button").forEach((b) => b.addEventListener("click", () => setTheme(b.dataset.themeVal)));
  $$("#langSeg button").forEach((b) => b.addEventListener("click", () => { setLang(b.dataset.lang); refreshLangUI(); }));
  $("#saveSettings").addEventListener("click", saveSettings);

  await loadConversations();
  await loadCollections();
  pollStatus();
  setInterval(pollStatus, 15000);
}

// Gancio di debug (console del browser / registrazioni automatiche)
window.__ailocaleDebug = { handleEvent, state };

init().catch((err) => { console.error(err); toast(err.message, true); });
