"""Voce (trascrizione e lettura), chiamata con risposte brevi, spegnimento sempre con permesso dell'utente."""
import asyncio
import json
import unittest

from helpers import FakeEmbedder, FakeLLM, cleanup, temp_settings, tool_call

from starlette.testclient import TestClient

from backend.app.main import create_app
from backend.app.tools.builtin import _power_preview
from backend.app.voice import speakable
from test_orchestrator import Env

H = {"X-AILocale": "1"}
BASE = "http://127.0.0.1:8765"
SEEN: dict = {}


def script(role, messages, i):
    if role == "planner":
        SEEN["planner_user"] = messages[-1]["content"]
        return {"direct": True, "tasks": []}
    if role == "synth":
        SEEN["synth_system"] = messages[0]["content"]
        return "Certo, ecco la risposta."
    return "ok"


class VoiceApiTest(unittest.TestCase):
    def setUp(self):
        SEEN.clear()
        self.settings, self.tmp = temp_settings()
        self.app = create_app(self.settings, llm=FakeLLM(script), embedder=FakeEmbedder())
        self.client = TestClient(self.app, base_url=BASE)
        self.client.__enter__()

    def tearDown(self):
        self.client.__exit__(None, None, None)
        cleanup(self.tmp)

    def services(self):
        return self.app.state.svc

    def test_status_and_missing_engines(self):
        st = self.client.get("/api/voice/status").json()
        self.assertIn("stt", st)
        self.assertIn("tts", st)
        r = self.client.post("/api/voice/speak", json={"text": "ciao"}, headers=H)
        if not st["tts"]:
            self.assertEqual(r.status_code, 503)
        self.assertEqual(self.client.post("/api/voice/speak", json={"text": "  **  "}, headers=H).status_code, 400)

    def test_transcribe_uses_engine_and_validates(self):
        voice = self.services().voice

        async def fake(audio, lang):
            return {"text": f"ho sentito {len(audio)} byte", "language": lang, "duration": 1.0}
        voice.transcribe = fake
        files = {"audio": ("voce.webm", b"x" * 1000, "audio/webm")}
        r = self.client.post("/api/voice/transcribe", files=files, data={"language": "it"}, headers=H)
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.json()["text"], "ho sentito 1000 byte")
        tiny = self.client.post("/api/voice/transcribe", files={"audio": ("v.webm", b"x", "audio/webm")}, headers=H)
        self.assertEqual(tiny.json()["text"], "")
        self.assertEqual(self.client.post("/api/voice/transcribe", data={"x": "1"}, headers=H).status_code, 400)
        self.assertEqual(self.client.post("/api/voice/transcribe", files=files).status_code, 403)  # CSRF

    def test_voice_message_asks_for_short_spoken_answer(self):
        c = self.client.post("/api/conversations", json={}, headers=H).json()
        r = self.client.post(f"/api/conversations/{c['id']}/messages", json={"content": "che ore sono?", "voice": True},
                             headers=H)
        rid = r.json()["run_id"]
        with self.client.stream("GET", f"/api/runs/{rid}/events") as s:
            for line in s.iter_lines():
                if line.startswith("data:") and json.loads(line[5:])["type"] == "stream_end":
                    break
        self.assertIn("VOICE CALL", SEEN["planner_user"])
        self.assertIn("read aloud", SEEN["synth_system"])
        self.assertIn("running on the user's own PC", SEEN["synth_system"])


class SpeakableTest(unittest.TestCase):
    def test_markdown_is_cleaned(self):
        out = speakable("## Titolo\n\n- **uno** e `due`\n\n```python\nprint(1)\n```\nVedi [sito](https://x.it) https://y.it")
        self.assertNotIn("#", out)
        self.assertNotIn("*", out)
        self.assertNotIn("print(1)", out)
        self.assertNotIn("https", out)
        self.assertIn("uno e due", out)
        self.assertIn("sito", out)


class PowerActionTest(unittest.TestCase):
    def test_preview(self):
        self.assertIn("Spegnere il PC", _power_preview({"action": "spegni"}))
        self.assertIn("60 secondi", _power_preview({"action": "spegni"}))
        self.assertIn("Bloccare", _power_preview({"action": "blocca"}))

    def test_always_asks_user_even_in_autonomous_mode(self):
        seen = {}

        def scr(role, messages, i):
            if role == "planner":
                return {"tasks": [{"id": "t1", "agent": "operatore", "goal": "spegni il pc"}]}
            if role == "operator":
                if i == 0:
                    return tool_call("power_action", action="spegni")
                seen["out"] = messages[-1]["content"]
                return "non spento"
            if role == "guardian":
                return {"approve": True, "reason": "ok"}
            if role == "critic":
                return {"approved": True}
            return "fine"
        env = Env(scr)
        env.db.set_tunables({"autonomous_mode": True})

        async def on_event(ev):
            if ev["type"] == "approval_required":
                seen["asked"] = ev["data"]["tool"]
                env.approvals.resolve(ev["data"]["approval_id"], False)
        try:
            _, events = asyncio.run(env.run("spegni il pc", on_event=on_event))
            self.assertEqual(seen["asked"], "power_action")
            self.assertNotIn("guard_review", [e["type"] for e in events])
            self.assertIn("NON ha approvato", seen["out"])
            self.assertEqual(env.llm.counts.get("guardian", 0), 0)
        finally:
            env.close()


if __name__ == "__main__":
    unittest.main()
