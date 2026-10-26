import asyncio
import unittest

from helpers import FakeLLM, cleanup, temp_settings, tool_call

from backend.app.db import Database
from backend.app.llm import ChatResult
from backend.app.orchestrator import ApprovalManager, Orchestrator, RunManager, Task, _break_cycles
from backend.app.rag import RAG
from backend.app.tools.builtin import build_registry


class Env:
    def __init__(self, script):
        self.settings, self.tmp = temp_settings()
        self.db = Database(self.settings.db_path)
        self.llm = FakeLLM(script)
        self.rag = RAG(self.db, self.settings.data_dir / "documents", None)
        self.approvals = ApprovalManager()
        self.orch = Orchestrator(self.llm, build_registry(), self.db, self.rag, self.settings, self.approvals)
        self.runs = RunManager(self.orch, self.db)
        self.conv = self.db.create_conversation()

    async def run(self, message, collections=None, on_event=None):
        rid = await self.runs.start(self.conv["id"], message, collections or [])
        events = []
        async for ev in self.runs.subscribe(rid):
            if ev["type"] == "ping":
                continue
            events.append(ev)
            if on_event:
                await on_event(ev)
        return rid, events

    def close(self):
        self.db.close()
        cleanup(self.tmp)


def types(events):
    return [e["type"] for e in events]


class OrchestratorTest(unittest.TestCase):
    def test_direct_answer_for_small_talk(self):
        def script(role, messages, i):
            if role == "planner":
                return {"reasoning": "saluto", "direct": True, "tasks": []}
            if role == "synth":
                return "Ciao! Come posso aiutarti?"
            raise AssertionError(role)
        env = Env(script)
        try:
            rid, ev = asyncio.run(env.run("ciao"))
            self.assertIn("final", types(ev))
            final = next(e for e in ev if e["type"] == "final")
            self.assertEqual(final["data"]["content"], "Ciao! Come posso aiutarti?")
            self.assertEqual(env.db.get_run(rid)["status"], "completed")
            msgs = env.db.messages(env.conv["id"])
            self.assertEqual([m["role"] for m in msgs], ["user", "assistant"])
            self.assertEqual(env.db.get_conversation(env.conv["id"])["title"], "ciao")
            tokens = "".join(e["data"]["text"] for e in ev if e["type"] == "token")
            self.assertEqual(tokens.strip(), "Ciao! Come posso aiutarti?")
        finally:
            env.close()

    def test_full_team_flow_parallel_deps_critic_revision_and_consult(self):
        def script(role, messages, i):
            if role == "planner":
                return {"reasoning": "serve codice e testo", "tasks": [
                    {"id": "t1", "agent": "programmatore", "goal": "scrivi la funzione", "depends_on": []},
                    {"id": "t2", "agent": "analista", "goal": "analizza complessità", "depends_on": []},
                    {"id": "t3", "agent": "scrittore", "goal": "documenta", "depends_on": ["t1", "t2"]},
                ]}
            if role == "programmer":
                if i == 0:
                    return tool_call("note", text="Uso Python 3")
                if i == 1:
                    return "def f(): return 1  # bozza"
                return "def f():\n    return 42"
            if role == "analyst":
                if i == 0:
                    return tool_call("ask_agent", agent="programmatore", question="che linguaggio?")
                return "Complessità O(1)"
            if role == "consult":
                return "Python"
            if role == "writer":
                board = messages[1]["content"]
                assert "return 42" in board and "O(1)" in board, "lo scrittore deve vedere i risultati"
                return "Documentazione completa"
            if role == "critic":
                user = messages[1]["content"]
                if "bozza" in user:
                    return {"approved": False, "score": 4, "issues": ["valore errato"], "suggestion": "ritorna 42"}
                return {"approved": True, "score": 9, "issues": []}
            if role == "synth":
                return "Risposta finale del team"
            raise AssertionError(role)
        env = Env(script)
        try:
            rid, ev = asyncio.run(env.run("scrivi una funzione"))
            t = types(ev)
            self.assertEqual(t[0], "run_started")
            self.assertEqual(t[-1], "run_finished")
            plan = next(e for e in ev if e["type"] == "plan")["data"]
            self.assertEqual(len(plan["tasks"]), 3)
            # t3 parte solo dopo la fine di t1 e t2
            start_t3 = next(e["seq"] for e in ev if e["type"] == "task_started" and e["data"]["task_id"] == "t3")
            fin = [e["seq"] for e in ev if e["type"] == "task_finished" and e["data"]["task_id"] in ("t1", "t2")]
            self.assertTrue(all(s < start_t3 for s in fin))
            reviews = [e["data"] for e in ev if e["type"] == "review"]
            self.assertTrue(any(not r["approved"] for r in reviews))
            t1_done = next(e["data"] for e in ev if e["type"] == "task_finished" and e["data"]["task_id"] == "t1")
            self.assertEqual(t1_done["revisions"], 1)
            self.assertIn("42", t1_done["result"])
            self.assertIn("consult", t)
            self.assertIn("consult_reply", t)
            self.assertIn("note", t)
            run = env.db.get_run(rid)
            self.assertEqual(run["status"], "completed")
            self.assertGreaterEqual(run["stats"]["llm_calls"], 10)
            # eventi persistiti (senza token)
            persisted = env.db.events(rid)
            self.assertNotIn("token", [e["type"] for e in persisted])
            self.assertIn("final", [e["type"] for e in persisted])
        finally:
            env.close()

    def test_run_python_requires_approval_and_runs_when_approved(self):
        def script(role, messages, i):
            if role == "planner":
                return {"tasks": [{"id": "t1", "agent": "analista", "goal": "calcola"}]}
            if role == "analyst":
                if i == 0:
                    return tool_call("run_python", code="print(6*7)")
                tool_out = messages[-1]["content"]
                return f"Risultato: {tool_out}"
            if role == "critic":
                return {"approved": True}
            return "fine"
        env = Env(script)

        async def on_event(ev):
            if ev["type"] == "approval_required":
                self.assertEqual(ev["data"]["preview"], "print(6*7)")
                env.approvals.resolve(ev["data"]["approval_id"], True)
        try:
            _, ev = asyncio.run(env.run("quanto fa 6*7", on_event=on_event))
            res = next(e["data"] for e in ev if e["type"] == "tool_result")
            self.assertTrue(res["ok"])
            self.assertIn("42", res["output"])
        finally:
            env.close()

    def test_denied_command_is_not_executed(self):
        marker = {}

        def script(role, messages, i):
            if role == "planner":
                return {"tasks": [{"id": "t1", "agent": "operatore", "goal": "crea file"}]}
            if role == "operator":
                if i == 0:
                    return tool_call("run_command", command="echo ciao > creato.txt")
                marker["seen"] = messages[-1]["content"]
                return "Non autorizzato"
            if role == "critic":
                return {"approved": True}
            return "fine"
        env = Env(script)

        async def on_event(ev):
            if ev["type"] == "approval_required":
                env.approvals.resolve(ev["data"]["approval_id"], False)
        try:
            asyncio.run(env.run("crea un file", on_event=on_event))
            self.assertIn("NON ha approvato", marker["seen"])
            self.assertFalse((env.settings.workspace_dir / "creato.txt").exists())
        finally:
            env.close()

    def test_tool_not_allowed_for_agent(self):
        seen = {}

        def script(role, messages, i):
            if role == "planner":
                return {"tasks": [{"id": "t1", "agent": "ricercatore", "goal": "x"}]}
            if role == "researcher":
                if i == 0:
                    return tool_call("run_command", command="dir")
                seen["out"] = messages[-1]["content"]
                return "ok"
            if role == "critic":
                return {"approved": True}
            return "fine"
        env = Env(script)
        try:
            asyncio.run(env.run("x"))
            self.assertIn("non è disponibile", seen["out"])
        finally:
            env.close()

    def test_invalid_plan_falls_back_to_direct(self):
        def script(role, messages, i):
            if role == "planner":
                return "non è json"
            return "risposta diretta"
        env = Env(script)
        try:
            _, ev = asyncio.run(env.run("domanda"))
            plan = next(e for e in ev if e["type"] == "plan")["data"]
            self.assertTrue(plan["direct"])
            self.assertEqual(next(e for e in ev if e["type"] == "final")["data"]["content"], "risposta diretta")
        finally:
            env.close()

    def test_unknown_agent_and_selected_docs_force_research(self):
        def script(role, messages, i):
            if role == "planner":
                return {"direct": True, "tasks": []}
            if role == "researcher":
                return "Nei documenti non c'è nulla"
            if role == "critic":
                return {"approved": True}
            return "fine"
        env = Env(script)
        try:
            _, ev = asyncio.run(env.run("cosa dice il manuale?", collections=["manuali"]))
            plan = next(e for e in ev if e["type"] == "plan")["data"]
            self.assertEqual(plan["tasks"][0]["agent"], "ricercatore")
        finally:
            env.close()

    def test_llm_down_marks_run_failed(self):
        from backend.app.llm import LLMError

        def script(role, messages, i):
            raise LLMError("Impossibile collegarsi al server LLM")
        env = Env(script)
        try:
            rid, ev = asyncio.run(env.run("ciao"))
            self.assertIn("error", types(ev))
            self.assertEqual(env.db.get_run(rid)["status"], "failed")
            self.assertIn("failed", env.db.messages(env.conv["id"])[-1]["content"])
        finally:
            env.close()

    def test_cancel_run(self):
        async def scenario(env):
            rid = await env.runs.start(env.conv["id"], "lungo", [])
            await asyncio.sleep(0.05)
            self.assertTrue(env.runs.cancel(rid))
            evs = [e async for e in env.runs.subscribe(rid)]
            return rid, evs

        def script(role, messages, i):
            if role == "planner":
                return {"tasks": [{"id": "t1", "agent": "operatore", "goal": "x"}]}
            if role == "operator":
                return tool_call("run_command", command="echo x")
            return {"approved": True}
        env = Env(script)
        try:
            rid, ev = asyncio.run(scenario(env))
            self.assertEqual(env.db.get_run(rid)["status"], "cancelled")
            self.assertEqual(env.approvals.pending, {})
        finally:
            env.close()

    def test_break_cycles(self):
        ts = [Task("a", "x", "", ["b"]), Task("b", "x", "", ["a"])]
        _break_cycles(ts)
        self.assertTrue(not ts[0].depends_on or not ts[1].depends_on)

    def test_agent_step_limit_forces_final_answer(self):
        def script(role, messages, i):
            if role == "planner":
                return {"tasks": [{"id": "t1", "agent": "ricercatore", "goal": "x"}]}
            if role == "researcher":
                if messages[-1]["role"] == "user" and "step limit" in messages[-1]["content"]:
                    return "risultato forzato"
                return tool_call("recall_memory", query="x")
            if role == "critic":
                return {"approved": True}
            return "fine"
        env = Env(script)
        env.db.set_tunables({"max_tool_steps": 2})
        try:
            _, ev = asyncio.run(env.run("x"))
            done = next(e["data"] for e in ev if e["type"] == "task_finished")
            self.assertEqual(done["result"], "risultato forzato")
        finally:
            env.close()


if __name__ == "__main__":
    unittest.main()
