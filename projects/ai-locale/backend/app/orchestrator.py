"""Motore multi-agente.

Flusso di un "run" (una richiesta dell'utente):

1. PIANIFICAZIONE  - il Coordinatore legge richiesta, cronologia e memoria e
                     produce un piano JSON: compiti, agente assegnato, dipendenze.
2. ESECUZIONE      - i compiti senza dipendenze in sospeso partono in parallelo
                     (fino a `parallel_agents`). Ogni agente lavora in un ciclo
                     ragiona -> usa strumento -> osserva, legge la lavagna
                     condivisa e può consultare un collega (`ask_agent`).
3. REVISIONE       - il Critico valuta ogni risultato; se lo boccia, l'agente
                     corregge il lavoro usando il feedback (max `max_revisions`).
4. SINTESI         - il Coordinatore unisce i risultati in una risposta finale,
                     trasmessa in streaming.

Ogni passaggio emette eventi che l'interfaccia mostra in tempo reale.
"""
from __future__ import annotations

import asyncio
import json
import logging
import time
import uuid
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any, Callable

from .agents import AGENTS, team_description
from .db import Database, new_id
from .llm import ChatModel, ChatResult, LLMError, extract_json
from .tools.builtin import ToolContext, truncate
from .tools.registry import ToolError, ToolRegistry

log = logging.getLogger("ailocale.orchestrator")

MAX_CONSULTS_PER_RUN = 6
PERSISTED_EVENT_SKIP = {"token"}


# ---------------------------------------------------------------------------
# Lavagna condivisa
# ---------------------------------------------------------------------------
@dataclass
class BlackboardEntry:
    kind: str  # result | note | review
    agent: str
    text: str
    task_id: str | None = None


class Blackboard:
    def __init__(self) -> None:
        self.entries: list[BlackboardEntry] = []

    def post(self, kind: str, agent: str, text: str, task_id: str | None = None) -> None:
        self.entries.append(BlackboardEntry(kind, agent, text, task_id))

    def summary(self, max_chars: int = 6000, per_entry: int = 1500, exclude_task: str | None = None) -> str:
        lines = []
        for e in self.entries:
            if exclude_task and e.task_id == exclude_task and e.kind == "result":
                continue
            label = {"result": "RESULT", "note": "NOTE", "review": "REVIEW"}.get(e.kind, e.kind.upper())
            tid = f" {e.task_id}" if e.task_id else ""
            lines.append(f"[{label}{tid} by {e.agent}]\n{truncate(e.text, per_entry)}")
        text = "\n\n".join(lines)
        if len(text) > max_chars:
            text = "...\n" + text[-max_chars:]
        return text or "(empty)"


# ---------------------------------------------------------------------------
# Stato di un run
# ---------------------------------------------------------------------------
@dataclass
class Task:
    id: str
    agent: str
    goal: str
    depends_on: list[str] = field(default_factory=list)
    status: str = "pending"  # pending|running|done|failed
    result: str = ""
    evidence: list[str] = field(default_factory=list)
    review: dict | None = None
    revisions: int = 0


class RunContext:
    def __init__(self, run_id: str, conversation_id: str, user_message: str, tunables: dict,
                 collections: list[str], emitter: Callable[[str, dict], Any], attachments: list[str] | None = None):
        self.run_id = run_id
        self.conversation_id = conversation_id
        self.user_message = user_message
        self.tunables = tunables
        self.collections = collections
        self.blackboard = Blackboard()
        self.sources: dict[str, dict] = {}
        self.attachments = attachments or []
        self.capabilities: dict[str, bool] = {}
        self.consults = 0
        self.stats = {"llm_calls": 0, "prompt_tokens": 0, "completion_tokens": 0,
                      "tool_calls": 0, "llm_seconds": 0.0}
        self._emitter = emitter
        self.started = time.time()

    async def emit(self, etype: str, **data: Any) -> None:
        await self._emitter(etype, data)

    def add_source(self, hit: dict) -> None:
        key = f"{hit['filename']}#{hit.get('page')}"
        self.sources.setdefault(key, {"filename": hit["filename"], "page": hit.get("page"),
                                      "collection": hit.get("collection")})

    def add_web_source(self, title: str, url: str) -> None:
        self.sources.setdefault(url, {"filename": (title or url)[:120], "url": url, "page": None})

    def track(self, r: ChatResult) -> None:
        self.stats["llm_calls"] += 1
        self.stats["prompt_tokens"] += r.prompt_tokens
        self.stats["completion_tokens"] += r.completion_tokens
        self.stats["llm_seconds"] += r.seconds


# ---------------------------------------------------------------------------
# Approvazioni
# ---------------------------------------------------------------------------
@dataclass
class PendingApproval:
    id: str
    run_id: str
    agent: str
    tool: str
    preview: str
    created: float
    future: asyncio.Future


class ApprovalManager:
    def __init__(self) -> None:
        self.pending: dict[str, PendingApproval] = {}

    async def request(self, ctx: RunContext, agent: str, tool: str, preview: str,
                      task_id: str | None, timeout: float) -> bool:
        aid = uuid.uuid4().hex[:12]
        fut: asyncio.Future = asyncio.get_running_loop().create_future()
        self.pending[aid] = PendingApproval(aid, ctx.run_id, agent, tool, preview, time.time(), fut)
        await ctx.emit("approval_required", approval_id=aid, agent=agent, tool=tool,
                       preview=preview[:4000], task_id=task_id, timeout=timeout)
        try:
            approved = await asyncio.wait_for(fut, timeout=timeout)
        except asyncio.TimeoutError:
            approved = False
            await ctx.emit("approval_resolved", approval_id=aid, approved=False, reason="timeout")
            return False
        finally:
            self.pending.pop(aid, None)
        await ctx.emit("approval_resolved", approval_id=aid, approved=approved)
        return approved

    def resolve(self, approval_id: str, approved: bool) -> bool:
        p = self.pending.get(approval_id)
        if not p or p.future.done():
            return False
        p.future.set_result(bool(approved))
        return True

    def deny_run(self, run_id: str) -> None:
        for p in list(self.pending.values()):
            if p.run_id == run_id and not p.future.done():
                p.future.set_result(False)

    def list(self) -> list[dict]:
        return [{"id": p.id, "run_id": p.run_id, "agent": p.agent, "tool": p.tool,
                 "preview": p.preview[:4000], "created": p.created} for p in self.pending.values()]


# ---------------------------------------------------------------------------
# Prompt
# ---------------------------------------------------------------------------
def _today() -> str:
    return datetime.now().strftime("%Y-%m-%d")


def planner_prompt(max_tasks: int, has_docs: bool, caps: dict | None = None, attachments: list[str] | None = None) -> str:
    caps = caps or {}
    docs_hint = ("The user selected document collections for this request: involve the 'ricercatore' "
                 "to search them.\n" if has_docs else "")
    if attachments:
        docs_hint += (f"The user attached images: {', '.join(attachments)}. "
                      + ("Assign the 'visione' agent to analyze them.\n" if caps.get("vision") else
                         "WARNING: no vision model is active, images cannot be analyzed; say so.\n"))
    if not caps.get("web"):
        docs_hint += "Web access is DISABLED: do not plan web searches or browsing.\n"
    if not caps.get("browser"):
        docs_hint += "The automated browser is not installed: 'navigatore' can only use web_search/fetch_url.\n"
    return f"""You are the Coordinator of a local team of AI agents. Today is {_today()}.
Your job now is ONLY to plan. Decide which agents must work on the user's request.

Team:
{team_description()}

Rules:
- Use the FEWEST agents needed. Greetings, small talk and simple questions you can answer
  yourself: return "direct": true and an empty task list.
- At most {max_tasks} tasks. Each "goal" must be self-contained and specific.
- Use "depends_on" when a task needs another task's result; independent tasks run in parallel.
- Current information (news, prices, versions, people, events) needs 'ricercatore' (web search) or
  'navigatore' (interactive browsing). Building software or files needs 'programmatore'.
- Only use agent ids from the team list.
{docs_hint}
Reply with JSON only, no other text:
{{"reasoning": "one short sentence", "direct": false,
  "tasks": [{{"id": "t1", "agent": "ricercatore", "goal": "...", "depends_on": []}}]}}"""


AGENT_RULES = """
Rules for every agent:
- Today is {today}. Reply in the same language as the user's request.
- Work only on YOUR task; other agents handle the rest. Read the shared blackboard for their results.
- Use tools when they help; do not invent tool results, files, sources or numbers.
- If you need a colleague's expertise, use ask_agent (colleagues: {colleagues}).
- If a tool is denied or fails, adapt and explain; never try to bypass a denial.
- Finish with your complete result for the task (not a plan of what you would do)."""

CRITIC_PROMPT = """You are the Critic of a team of AI agents. Review one agent's result for its task.
Check: correctness, completeness vs the goal, invented facts/sources, code bugs, unsafe actions.
Be fair: approve results that are correct and adequate even if not perfect.
Reply with JSON only:
{"approved": true, "score": 8, "issues": ["..."], "suggestion": "how to fix, if not approved"}"""

SYNTH_PROMPT = """You are the Coordinator of a team of local AI agents. Today is {today}.
Write the final answer to the user, using the team's work on the shared blackboard below.
- Reply in the user's language, directly and well structured (Markdown allowed).
- Integrate the results; do not describe the internal process unless useful.
- Keep citations like [file, p. N] for documents and [title](url) for web sources.
- For web information, distinguish verified facts from unconfirmed claims.
- If something failed, was denied or is uncertain, say so honestly. Never invent results.
{memory}
SHARED BLACKBOARD:
{blackboard}"""

DIRECT_PROMPT = """You are a helpful local AI assistant (the Coordinator of an agent team). Today is {today}.
Reply in the user's language, clearly and concisely. Markdown allowed. Do not invent facts.
{memory}"""


# ---------------------------------------------------------------------------
# Orchestratore
# ---------------------------------------------------------------------------
class Orchestrator:
    def __init__(self, llm: ChatModel, tools: ToolRegistry, db: Database, rag: Any, settings: Any,
                 approvals: ApprovalManager, web: Any = None, browser: Any = None, vision: Any = None):
        self.web = web
        self.browser = browser
        self.vision = vision
        self.llm = llm
        self.tools = tools
        self.db = db
        self.rag = rag
        self.settings = settings
        self.approvals = approvals

    # -- utilità --------------------------------------------------------------
    def _nothink(self, ctx: RunContext, text: str) -> str:
        return text + (" /no_think" if ctx.tunables.get("disable_thinking") else "")

    async def _chat(self, ctx: RunContext, messages: list[dict], **kw) -> ChatResult:
        kw.setdefault("temperature", ctx.tunables.get("temperature", 0.4))
        kw.setdefault("max_tokens", ctx.tunables.get("max_tokens"))
        r = await self.llm.chat(messages, **kw)
        ctx.track(r)
        return r

    def _memory_block(self) -> str:
        mems = self.db.list_memories()[:15]
        if not mems:
            return ""
        return "Known facts about the user (persistent memory):\n" + "\n".join(f"- {m['content']}" for m in mems) + "\n"

    def _history(self, ctx: RunContext) -> list[dict]:
        n = int(ctx.tunables.get("history_messages", 8))
        if n <= 0:
            return []
        msgs = self.db.messages(ctx.conversation_id, limit=n + 1)
        # l'ultimo messaggio è la richiesta corrente: la aggiungiamo a parte
        if msgs and msgs[-1]["role"] == "user" and msgs[-1]["content"] == ctx.user_message:
            msgs = msgs[:-1]
        return [{"role": m["role"], "content": truncate(m["content"], 2500)} for m in msgs
                if m["role"] in ("user", "assistant")]

    # -- 1. pianificazione -------------------------------------------------------
    async def plan(self, ctx: RunContext) -> tuple[list[Task], bool, str]:
        await ctx.emit("planning", agent="coordinatore")
        history = self._history(ctx)
        hist_txt = "\n".join(f"{m['role']}: {truncate(m['content'], 400)}" for m in history[-6:])
        user = (f"Conversation so far:\n{hist_txt or '(none)'}\n\n" if history else "") + \
               f"User request:\n{ctx.user_message}"
        messages = [{"role": "system", "content": planner_prompt(ctx.tunables["max_tasks"], bool(ctx.collections),
                                                                 ctx.capabilities, ctx.attachments)
                     + "\n" + self._memory_block()},
                    {"role": "user", "content": self._nothink(ctx, user)}]
        try:
            r = await self._chat(ctx, messages, json_mode=True, temperature=0.2)
            data = extract_json(r.content)
        except (ValueError, LLMError) as exc:
            if isinstance(exc, LLMError):
                raise
            log.warning("piano non valido, risposta diretta: %s", exc)
            return [], True, "Piano non interpretabile: rispondo direttamente."

        reasoning = str(data.get("reasoning", ""))[:500]
        tasks: list[Task] = []
        seen: set[str] = set()
        for i, raw in enumerate(data.get("tasks") or []):
            if not isinstance(raw, dict) or len(tasks) >= ctx.tunables["max_tasks"]:
                continue
            agent = str(raw.get("agent", "")).strip().lower()
            if agent not in AGENTS or not AGENTS[agent].worker:
                agent = "scrittore"
            tid = str(raw.get("id") or f"t{i + 1}")
            if tid in seen:
                tid = f"t{i + 1}_{len(tasks)}"
            seen.add(tid)
            goal = str(raw.get("goal", "")).strip() or ctx.user_message
            deps = [str(d) for d in (raw.get("depends_on") or []) if isinstance(d, (str, int))]
            tasks.append(Task(id=tid, agent=agent, goal=goal[:1500], depends_on=deps))
        ids = {t.id for t in tasks}
        for t in tasks:  # rimuove dipendenze inesistenti o su se stessi
            t.depends_on = [d for d in t.depends_on if d in ids and d != t.id]
        tasks = _break_cycles(tasks)
        direct = bool(data.get("direct")) or not tasks
        if ctx.attachments and direct and ctx.capabilities.get("vision"):
            tasks = [Task(id="t1", agent="visione",
                          goal=f"Analyze the attached images {', '.join(ctx.attachments)} to answer: {ctx.user_message}")]
            direct = False
        if ctx.collections and direct:
            # l'utente ha selezionato documenti: almeno il ricercatore deve consultarli
            tasks = [Task(id="t1", agent="ricercatore",
                          goal=f"Search the selected documents to answer: {ctx.user_message}")]
            direct = False
        return tasks, direct, reasoning

    # -- 2. esecuzione di un compito ------------------------------------------------
    def _agent_system(self, agent_id: str) -> str:
        spec = AGENTS[agent_id]
        colleagues = ", ".join(a for a in AGENTS if AGENTS[a].worker and a != agent_id)
        return spec.instructions + "\n" + AGENT_RULES.format(today=_today(), colleagues=colleagues) + \
            "\n" + self._memory_block()

    def _tool_ctx(self, ctx: RunContext, agent: str) -> ToolContext:
        async def consult(src: str, dst: str, question: str) -> str:
            return await self.consult(ctx, src, dst, question)
        async def approve(tool: str, preview: str) -> bool:
            return await self.approvals.request(ctx, agent, tool, preview, None, self.settings.approval_timeout)
        return ToolContext(settings=self.settings, db=self.db, rag=self.rag, agent=agent, run=ctx, consult=consult,
                           approve=approve, web=self.web, browser=self.browser, vision=self.vision)

    async def _call_tool(self, ctx: RunContext, task: Task | None, agent: str, name: str, args: dict,
                         call_id: str, allowed: list[str]) -> str:
        ctx.stats["tool_calls"] += 1
        tid = task.id if task else None
        await ctx.emit("tool_call", task_id=tid, agent=agent, tool=name, call_id=call_id,
                       args={k: truncate(str(v), 600) for k, v in args.items()})
        tool = self.tools.get(name)
        ok, output = False, ""
        try:
            if tool is None or name not in allowed:
                raise ToolError(f"Lo strumento '{name}' non è disponibile per questo agente.")
            if "_invalid_json" in args:
                raise ToolError("Argomenti non validi (JSON malformato). Riprova con JSON valido.")
            tctx = self._tool_ctx(ctx, agent)
            needs = tool.requires_approval(args, tctx) if callable(tool.requires_approval) else tool.requires_approval
            if needs:
                preview = tool.preview(args) if tool.preview else json.dumps(args, ensure_ascii=False)
                if not await self.approvals.request(ctx, agent, name, preview, tid, self.settings.approval_timeout):
                    raise ToolError("L'utente NON ha approvato questa azione. Non riprovarla; prosegui senza.")
            output = await tool.handler(tctx, **{k: v for k, v in args.items() if not k.startswith("_")})
            ok = True
        except ToolError as exc:
            output = f"ERRORE: {exc}"
        except TypeError as exc:
            output = f"ERRORE: argomenti non validi per {name}: {exc}"
        except asyncio.CancelledError:
            raise
        except Exception as exc:  # noqa: BLE001
            log.exception("errore nello strumento %s", name)
            output = f"ERRORE interno dello strumento: {type(exc).__name__}"
        try:
            self.db.add_audit(ctx.run_id, agent, name, json.dumps(args, ensure_ascii=False)[:500], ok,
                              output[:300] if not ok else "")
        except Exception:  # noqa: BLE001
            log.warning("audit non registrato")
        if task is not None:
            task.evidence.append(f"{name}({truncate(json.dumps(args, ensure_ascii=False), 200)}) -> "
                                 f"{truncate(output, 500)}")
        await ctx.emit("tool_result", task_id=tid, agent=agent, tool=name, call_id=call_id, ok=ok,
                       output=truncate(output, 1500))
        return output

    async def run_agent(self, ctx: RunContext, task: Task, feedback: str | None = None) -> str:
        spec = AGENTS[task.agent]
        board = ctx.blackboard.summary(exclude_task=task.id)
        user = (f"Overall user request:\n{ctx.user_message}\n\nYOUR TASK ({task.id}): {task.goal}\n\n"
                f"Shared blackboard (work of the other agents):\n{board}")
        if ctx.collections:
            user += f"\n\nSelected document collections: {', '.join(ctx.collections)}"
        if ctx.attachments:
            user += f"\n\nImages attached by the user: {', '.join(ctx.attachments)}"
        if feedback:
            user += (f"\n\nYour previous result:\n{truncate(task.result, 3000)}\n\n"
                     f"The Critic rejected it. Feedback:\n{feedback}\nProduce an improved, complete result.")
        messages: list[dict] = [{"role": "system", "content": self._agent_system(task.agent)},
                                {"role": "user", "content": self._nothink(ctx, user)}]
        schemas = self.tools.schemas(spec.tools)
        steps = int(ctx.tunables.get("max_tool_steps", 6))
        for _ in range(steps):
            r = await self._chat(ctx, messages, tools=schemas)
            if not r.tool_calls:
                return r.content or "(nessun risultato)"
            messages.append({"role": "assistant", "content": r.content or "",
                             "tool_calls": [{"id": c.id, "type": "function",
                                             "function": {"name": c.name,
                                                          "arguments": json.dumps(c.arguments, ensure_ascii=False)}}
                                            for c in r.tool_calls]})
            for c in r.tool_calls:
                out = await self._call_tool(ctx, task, task.agent, c.name, c.arguments, c.id, spec.tools)
                messages.append({"role": "tool", "tool_call_id": c.id, "name": c.name, "content": out})
        messages.append({"role": "user", "content": self._nothink(
            ctx, "Tool step limit reached. Now give your final result for the task, without tools.")})
        r = await self._chat(ctx, messages)
        return r.content or "(nessun risultato)"

    async def consult(self, ctx: RunContext, src: str, dst: str, question: str) -> str:
        dst = (dst or "").strip().lower()
        if dst not in AGENTS or not AGENTS[dst].worker:
            return f"ERRORE: agente '{dst}' inesistente. Disponibili: " + \
                ", ".join(a for a in AGENTS if AGENTS[a].worker)
        if dst == src:
            return "ERRORE: non puoi consultare te stesso."
        if ctx.consults >= MAX_CONSULTS_PER_RUN:
            return "ERRORE: limite di consultazioni raggiunto per questa richiesta."
        ctx.consults += 1
        await ctx.emit("consult", source=src, target=dst, question=truncate(question, 800))
        messages = [{"role": "system", "content": AGENTS[dst].instructions +
                     f"\nA colleague ({src}) asks for your help. Answer concisely and concretely, "
                     "in the language of the question. You cannot use tools now."},
                    {"role": "user", "content": self._nothink(
                        ctx, f"Shared blackboard:\n{ctx.blackboard.summary(max_chars=3000)}\n\nQuestion:\n{question}")}]
        r = await self._chat(ctx, messages)
        await ctx.emit("consult_reply", source=dst, target=src, answer=truncate(r.content, 1500))
        return r.content or "(nessuna risposta)"

    # -- 3. revisione ----------------------------------------------------------------
    async def review(self, ctx: RunContext, task: Task) -> dict:
        evidence = "\n".join(task.evidence[-8:]) or "(no tools used)"
        messages = [{"role": "system", "content": CRITIC_PROMPT},
                    {"role": "user", "content": self._nothink(
                        ctx, f"User request:\n{ctx.user_message}\n\nTask for {task.agent}: {task.goal}\n\n"
                             f"Tool evidence:\n{evidence}\n\nResult to review:\n{truncate(task.result, 5000)}")}]
        try:
            r = await self._chat(ctx, messages, json_mode=True, temperature=0.1)
            data = extract_json(r.content)
        except ValueError:
            return {"approved": True, "score": None, "issues": [], "suggestion": "",
                    "note": "revisione non interpretabile"}
        approved = data.get("approved")
        if isinstance(approved, str):
            approved = approved.strip().lower() in ("true", "yes", "si", "sì")
        issues = data.get("issues") or []
        if not isinstance(issues, list):
            issues = [str(issues)]
        score = data.get("score")
        try:
            score = max(0, min(10, int(score))) if score is not None else None
        except (TypeError, ValueError):
            score = None
        return {"approved": bool(approved) if approved is not None else True, "score": score,
                "issues": [str(i)[:300] for i in issues[:6]], "suggestion": str(data.get("suggestion") or "")[:800]}

    async def execute_task(self, ctx: RunContext, task: Task) -> None:
        task.status = "running"
        await ctx.emit("task_started", task_id=task.id, agent=task.agent, goal=task.goal, attempt=1)
        t0 = time.perf_counter()
        task.result = await self.run_agent(ctx, task)
        max_rev = int(ctx.tunables.get("max_revisions", 1))
        while ctx.tunables.get("critic_enabled", True):
            await ctx.emit("reviewing", task_id=task.id, agent="critico", target=task.agent)
            verdict = await self.review(ctx, task)
            task.review = verdict
            await ctx.emit("review", task_id=task.id, agent="critico", target=task.agent, **verdict)
            if verdict["approved"] or task.revisions >= max_rev:
                break
            task.revisions += 1
            feedback = "; ".join(verdict["issues"]) + ("\n" + verdict["suggestion"] if verdict["suggestion"] else "")
            await ctx.emit("task_started", task_id=task.id, agent=task.agent, goal=task.goal,
                           attempt=task.revisions + 1, feedback=truncate(feedback, 800))
            task.result = await self.run_agent(ctx, task, feedback=feedback)
        task.status = "done"
        ctx.blackboard.post("result", task.agent, task.result, task.id)
        if task.review and not task.review["approved"]:
            ctx.blackboard.post("review", "critico",
                                "Unresolved issues: " + "; ".join(task.review["issues"]), task.id)
        await ctx.emit("task_finished", task_id=task.id, agent=task.agent, result=truncate(task.result, 4000),
                       seconds=round(time.perf_counter() - t0, 1), revisions=task.revisions)

    async def execute_plan(self, ctx: RunContext, tasks: list[Task]) -> None:
        sem = asyncio.Semaphore(int(ctx.tunables.get("parallel_agents", 2)))
        by_id = {t.id: t for t in tasks}

        async def guarded(t: Task) -> None:
            async with sem:
                try:
                    await self.execute_task(ctx, t)
                except LLMError:
                    raise
                except asyncio.CancelledError:
                    raise
                except Exception as exc:  # noqa: BLE001
                    log.exception("compito %s fallito", t.id)
                    t.status, t.result = "failed", f"Compito fallito: {type(exc).__name__}"
                    ctx.blackboard.post("result", t.agent, t.result, t.id)
                    await ctx.emit("task_failed", task_id=t.id, agent=t.agent, error=t.result)

        while True:
            pending = [t for t in tasks if t.status == "pending"]
            if not pending:
                break
            ready = [t for t in pending if all(by_id[d].status in ("done", "failed") for d in t.depends_on)]
            if not ready:  # non dovrebbe succedere dopo _break_cycles
                ready = pending
            await asyncio.gather(*(guarded(t) for t in ready))

    # -- 4. sintesi --------------------------------------------------------------
    async def synthesize(self, ctx: RunContext, direct: bool) -> str:
        await ctx.emit("synthesis_started", agent="coordinatore")
        if direct:
            system = DIRECT_PROMPT.format(today=_today(), memory=self._memory_block())
        else:
            system = SYNTH_PROMPT.format(today=_today(), memory=self._memory_block(),
                                         blackboard=ctx.blackboard.summary(max_chars=9000, per_entry=3500))
        messages = [{"role": "system", "content": system}, *self._history(ctx),
                    {"role": "user", "content": self._nothink(ctx, ctx.user_message)}]

        async def on_token(tok: str) -> None:
            await ctx.emit("token", text=tok)

        r = await self._chat(ctx, messages, on_token=on_token)
        return r.content

    # -- run completo ------------------------------------------------------------
    async def capabilities(self, tunables: dict) -> dict:
        vision = False
        if self.vision is not None:
            try:
                vision = await self.vision.available()
            except Exception:  # noqa: BLE001
                vision = False
        browser = bool(self.browser is not None and self.browser.available())
        return {"web": bool(tunables.get("web_access", True)) and self.web is not None,
                "browser": browser and bool(tunables.get("web_access", True)), "vision": vision}

    async def run(self, ctx: RunContext) -> str:
        ctx.capabilities = await self.capabilities(ctx.tunables)
        await ctx.emit("run_started", message=truncate(ctx.user_message, 500), collections=ctx.collections,
                       attachments=ctx.attachments, capabilities=ctx.capabilities)
        tasks, direct, reasoning = await self.plan(ctx)
        await ctx.emit("plan", direct=direct, reasoning=reasoning,
                       tasks=[{"id": t.id, "agent": t.agent, "goal": t.goal, "depends_on": t.depends_on}
                              for t in tasks])
        if not direct:
            await self.execute_plan(ctx, tasks)
        answer = await self.synthesize(ctx, direct)
        return answer


def _break_cycles(tasks: list[Task]) -> list[Task]:
    """Rimuove le dipendenze che creano cicli (DFS)."""
    by_id = {t.id: t for t in tasks}
    state: dict[str, int] = {}

    def visit(t: Task) -> None:
        state[t.id] = 1
        for d in list(t.depends_on):
            if state.get(d) == 1:
                t.depends_on.remove(d)
            elif state.get(d) is None:
                visit(by_id[d])
        state[t.id] = 2

    for t in tasks:
        if state.get(t.id) is None:
            visit(t)
    return tasks


# ---------------------------------------------------------------------------
# Gestione dei run attivi ed eventi in tempo reale
# ---------------------------------------------------------------------------
class RunState:
    def __init__(self, run_id: str):
        self.run_id = run_id
        self.events: list[dict] = []
        self.done = False
        self.cond = asyncio.Condition()
        self.task: asyncio.Task | None = None


class RunManager:
    def __init__(self, orchestrator: Orchestrator, db: Database):
        self.orch = orchestrator
        self.db = db
        self.active: dict[str, RunState] = {}

    def is_busy(self, conversation_id: str) -> bool:
        return any(not s.done and getattr(s, "conversation_id", None) == conversation_id
                   for s in self.active.values())

    async def start(self, conversation_id: str, message: str, collections: list[str],
                    attachments: list[str] | None = None) -> str:
        run_id = new_id()
        state = RunState(run_id)
        state.conversation_id = conversation_id  # type: ignore[attr-defined]
        self.active[run_id] = state
        self.db.create_run(run_id, conversation_id)
        self.db.add_message(conversation_id, "user", message, run_id, attachments or [])
        conv = self.db.get_conversation(conversation_id)
        if conv and conv["title"] in ("Nuova conversazione", "New chat", ""):
            self.db.rename_conversation(conversation_id, message.strip().splitlines()[0][:60] or "Conversazione")

        seq = 0

        async def emitter(etype: str, data: dict) -> None:
            nonlocal seq
            seq += 1
            ev = {"seq": seq, "type": etype, "data": data, "ts": time.time()}
            if etype not in PERSISTED_EVENT_SKIP:
                self.db.add_event(run_id, seq, etype, data)
            async with state.cond:
                state.events.append(ev)
                state.cond.notify_all()

        ctx = RunContext(run_id, conversation_id, message, self.db.get_tunables(), collections, emitter, attachments)
        state.task = asyncio.create_task(self._run(ctx, state))
        return run_id

    async def _run(self, ctx: RunContext, state: RunState) -> None:
        status, error, answer = "completed", None, ""
        try:
            answer = await self.orch.run(ctx)
        except asyncio.CancelledError:
            status, error = "cancelled", "Annullato dall'utente"
        except LLMError as exc:
            status, error = "failed", str(exc)
        except Exception as exc:  # noqa: BLE001
            log.exception("run %s fallito", ctx.run_id)
            status, error = "failed", f"Errore interno: {type(exc).__name__}"
        stats = {**ctx.stats, "seconds": round(time.time() - ctx.started, 1)}
        stats["llm_seconds"] = round(stats["llm_seconds"], 1)
        if stats["llm_seconds"] > 0 and stats["completion_tokens"]:
            stats["tokens_per_second"] = round(stats["completion_tokens"] / stats["llm_seconds"], 1)
        try:
            if status == "completed":
                self.db.add_message(ctx.conversation_id, "assistant", answer, ctx.run_id)
                await ctx.emit("final", content=answer, sources=list(ctx.sources.values()))
            else:
                self.db.add_message(ctx.conversation_id, "assistant", f"**[{status}]** {error}", ctx.run_id)
                await ctx.emit("error", message=error, status=status)
            await ctx.emit("run_finished", status=status, stats=stats)
        finally:
            self.db.finish_run(ctx.run_id, status, error, stats)
            async with state.cond:
                state.done = True
                state.cond.notify_all()
            log.info("run %s %s in %.1fs (llm_calls=%s)", ctx.run_id, status, stats["seconds"], stats["llm_calls"])
            asyncio.get_running_loop().call_later(300, self.active.pop, ctx.run_id, None)

    def cancel(self, run_id: str) -> bool:
        state = self.active.get(run_id)
        if not state or state.done or not state.task:
            return False
        self.orch.approvals.deny_run(run_id)
        state.task.cancel()
        return True

    async def subscribe(self, run_id: str):
        """Restituisce gli eventi del run: prima quelli già emessi, poi quelli nuovi."""
        state = self.active.get(run_id)
        if state is None:
            for ev in self.db.events(run_id):
                yield ev
            return
        idx = 0
        while True:
            async with state.cond:
                while idx >= len(state.events) and not state.done:
                    try:
                        await asyncio.wait_for(state.cond.wait(), timeout=15)
                    except asyncio.TimeoutError:
                        break
                batch = state.events[idx:]
                idx = len(state.events)
                finished = state.done and idx >= len(state.events)
            if not batch and not finished:
                yield {"type": "ping", "data": {}, "seq": 0}
            for ev in batch:
                yield ev
            if finished:
                return
