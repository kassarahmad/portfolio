"""Progetti, artefatti e sessioni: API, cartella di lavoro del progetto, istruzioni nei prompt,
registrazione dei file creati, anteprime sicure."""
import json
import unittest
from pathlib import Path

from helpers import FakeEmbedder, FakeLLM, cleanup, temp_settings, tool_call

from starlette.testclient import TestClient

from backend.app import artifacts as artifacts_mod
from backend.app.main import create_app

H = {"X-AILocale": "1"}
BASE = "http://127.0.0.1:8765"
SEEN: dict = {}


def script(role, messages, i):
    if role == "planner":
        SEEN["planner_system"] = messages[0]["content"]
        return {"tasks": [{"id": "t1", "agent": "programmatore", "goal": "crea i file"}]}
    if role == "programmer":
        SEEN["programmer_system"] = messages[0]["content"]
        if i == 0:
            return tool_call("write_file", path="sito/index.html",
                             content="<!doctype html><link rel=stylesheet href=style.css><h1>Ciao</h1>")
        if i == 1:
            return tool_call("write_file", path="sito/style.css", content="h1{color:red}")
        if i == 2:
            return tool_call("write_file", path="dati.csv", content="nome,prezzo\nmargherita,6\ndiavola,7.5\n")
        return "Creati index.html, style.css e dati.csv"
    if role == "critic":
        return {"approved": True}
    return "Fatto: ho creato il sito e i dati."


def run(client, cid, text):
    r = client.post(f"/api/conversations/{cid}/messages", json={"content": text}, headers=H)
    assert r.status_code == 200, r.text
    rid = r.json()["run_id"]
    final = None
    with client.stream("GET", f"/api/runs/{rid}/events") as s:
        for line in s.iter_lines():
            if line.startswith("data:"):
                ev = json.loads(line[5:])
                if ev["type"] == "final":
                    final = ev["data"]
                if ev["type"] == "stream_end":
                    break
    return final


class ProjectsTest(unittest.TestCase):
    def setUp(self):
        SEEN.clear()
        self.settings, self.tmp = temp_settings()
        self.app = create_app(self.settings, llm=FakeLLM(script), embedder=FakeEmbedder())
        self.client = TestClient(self.app, base_url=BASE)
        self.client.__enter__()

    def tearDown(self):
        self.client.__exit__(None, None, None)
        cleanup(self.tmp)

    def test_project_crud_and_validation(self):
        c = self.client
        self.assertEqual(c.post("/api/projects", json={"name": "  "}, headers=H).status_code, 400)
        p = c.post("/api/projects", json={"name": "Pizzeria", "description": "sito", "instructions": "usa FastAPI",
                                          "color": "sage"}, headers=H).json()
        self.assertEqual(p["color"], "sage")
        self.assertTrue(Path(p["folder"]).is_dir())
        bad = c.patch(f"/api/projects/{p['id']}", json={"color": "fucsia", "name": "Pizzeria Buon Gusto"}, headers=H).json()
        self.assertEqual(bad["color"], "sage")  # colore non valido ignorato
        self.assertEqual(bad["name"], "Pizzeria Buon Gusto")
        self.assertEqual(len(c.get("/api/projects").json()["items"]), 1)
        conv = c.post("/api/conversations", json={"project_id": p["id"]}, headers=H).json()
        self.assertEqual(conv["project_id"], p["id"])
        self.assertEqual(c.delete(f"/api/projects/{p['id']}", headers=H).status_code, 200)
        # la sessione resta, fuori dal progetto
        self.assertIsNone(c.get(f"/api/conversations/{conv['id']}").json()["project_id"])
        self.assertEqual(c.get(f"/api/projects/{p['id']}").status_code, 404)

    def test_run_in_project_uses_folder_instructions_and_registers_artifacts(self):
        c = self.client
        p = c.post("/api/projects", json={"name": "Pizzeria", "instructions": "Scrivi sempre i test."}, headers=H).json()
        conv = c.post("/api/conversations", json={"project_id": p["id"]}, headers=H).json()
        final = run(c, conv["id"], "crea il sito")
        # istruzioni del progetto nei prompt
        self.assertIn("Scrivi sempre i test.", SEEN["planner_system"])
        self.assertIn("PROJECT: Pizzeria", SEEN["programmer_system"])
        # i file sono nella cartella del progetto
        folder = Path(p["folder"])
        self.assertTrue((folder / "sito" / "index.html").is_file())
        self.assertFalse((self.settings.workspace_dir / "sito").exists())
        # artefatti registrati e mostrati nell'evento finale
        titles = sorted(a["title"] for a in final["artifacts"])
        self.assertEqual(titles, ["dati.csv", "sito/index.html", "sito/style.css"])
        arts = c.get(f"/api/artifacts?project={p['id']}").json()["items"]
        self.assertEqual(len(arts), 3)
        self.assertTrue(all(a["conversation_id"] == conv["id"] for a in arts))
        detail = c.get(f"/api/conversations/{conv['id']}").json()
        self.assertEqual(detail["project"]["id"], p["id"])
        self.assertEqual(len(detail["artifacts"]), 3)
        proj = c.get(f"/api/projects/{p['id']}").json()
        self.assertEqual(len(proj["conversations"]), 1)
        self.assertEqual(proj["conversations"][0]["artifacts"], 3)
        # una seconda esecuzione che riscrive lo stesso file aumenta la versione
        run(c, conv["id"], "rifallo")
        arts2 = {a["title"]: a for a in c.get(f"/api/artifacts?conversation={conv['id']}").json()["items"]}
        self.assertEqual(len(arts2), 3)
        self.assertEqual(arts2["sito/index.html"]["versions"], 2)

    def test_artifact_previews_and_raw_are_sandboxed(self):
        c = self.client
        conv = c.post("/api/conversations", json={}, headers=H).json()
        run(c, conv["id"], "crea il sito")
        arts = {a["title"]: a for a in c.get("/api/artifacts").json()["items"]}
        csv_art = c.get(f"/api/artifacts/{arts['dati.csv']['id']}").json()
        self.assertEqual(csv_art["kind"], "data")
        self.assertEqual(csv_art["content"]["rows"][1], ["margherita", "6"])
        html = arts["sito/index.html"]
        detail = c.get(f"/api/artifacts/{html['id']}").json()
        self.assertEqual(detail["kind"], "html")
        self.assertIn("<h1>Ciao</h1>", detail["content"]["text"])
        raw = c.get(f"/api/artifacts/{html['id']}/raw")
        self.assertEqual(raw.status_code, 200)
        self.assertIn("sandbox", raw.headers["content-security-policy"])
        self.assertIn("connect-src 'none'", c.get(f"/api/artifacts/{html['id']}/site/index.html")
                      .headers["content-security-policy"])
        # i file vicini si caricano, ma non si esce dalla cartella dell'artefatto
        self.assertEqual(c.get(f"/api/artifacts/{html['id']}/site/style.css").text, "h1{color:red}")
        self.assertEqual(c.get(f"/api/artifacts/{html['id']}/site/..%2Fdati.csv").status_code, 404)
        self.assertEqual(c.get(f"/api/artifacts/{html['id']}/site/../dati.csv").status_code, 404)
        dl = c.get(f"/api/artifacts/{html['id']}/raw?download=1")
        self.assertIn("attachment", dl.headers["content-disposition"])
        # artefatto il cui file è sparito
        Path(html["path"]).unlink()
        self.assertEqual(c.get(f"/api/artifacts/{html['id']}").status_code, 404)
        self.assertEqual(c.delete(f"/api/artifacts/{html['id']}", headers=H).status_code, 200)

    def test_move_conversation_and_session_list(self):
        c = self.client
        p = c.post("/api/projects", json={"name": "Tesi"}, headers=H).json()
        conv = c.post("/api/conversations", json={}, headers=H).json()
        self.assertEqual(c.patch(f"/api/conversations/{conv['id']}", json={"project_id": "nope"}, headers=H).status_code, 404)
        r = c.patch(f"/api/conversations/{conv['id']}", json={"project_id": p["id"]}, headers=H).json()
        self.assertEqual(r["project_id"], p["id"])
        items = c.get(f"/api/conversations?project={p['id']}").json()["items"]
        self.assertEqual([x["id"] for x in items], [conv["id"]])
        self.assertIn("running", items[0])
        r = c.patch(f"/api/conversations/{conv['id']}", json={"project_id": None}, headers=H).json()
        self.assertIsNone(r["project_id"])


class ArtifactHelpersTest(unittest.TestCase):
    def test_kinds(self):
        k = artifacts_mod.kind_of
        self.assertEqual(k(Path("a/README.md")), "document")
        self.assertEqual(k(Path("app.py")), "code")
        self.assertEqual(k(Path("index.html")), "html")
        self.assertEqual(k(Path("dati.xlsx")), "data")
        self.assertEqual(k(Path("logo.svg")), "image")
        self.assertEqual(k(Path("sito.zip")), "archive")
        self.assertEqual(k(Path("Dockerfile")), "code")
        self.assertEqual(k(Path("strano.xyz")), "other")

    def test_scan_skips_dependencies(self):
        settings, tmp = temp_settings()
        try:
            base = settings.workspace_dir
            (base / "node_modules" / "x").mkdir(parents=True)
            (base / "node_modules" / "x" / "index.js").write_text("x")
            (base / ".venv").mkdir()
            (base / ".venv" / "a.py").write_text("x")
            (base / "src").mkdir()
            (base / "src" / "app.py").write_text("print(1)")
            found = [p.name for p in artifacts_mod.scan_changed(base, 0)]
            self.assertEqual(found, ["app.py"])
        finally:
            cleanup(tmp)


if __name__ == "__main__":
    unittest.main()
