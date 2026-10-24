"""Server di prova per verificare l'interfaccia senza GPU (usa il modello finto dei test).
NON è la modalità d'uso reale: serve solo per i test visivi dell'interfaccia.

    python tests/ui_demo_server.py [ritardo_secondi]     -> http://127.0.0.1:8799
"""
import sys

import uvicorn

from helpers import FakeEmbedder, FakeLLM, temp_settings, tool_call
from backend.app.main import create_app


def script(role, messages, i):
    if role == "planner":
        return {"reasoning": "Serve ricerca, codice verificato, analisi e una spiegazione chiara.", "tasks": [
            {"id": "t1", "agent": "ricercatore", "goal": "Cerca nei documenti le linee guida sul codice", "depends_on": []},
            {"id": "t2", "agent": "programmatore", "goal": "Correggi la funzione media e verificala", "depends_on": []},
            {"id": "t3", "agent": "analista", "goal": "Controlla i casi limite della funzione", "depends_on": []},
            {"id": "t4", "agent": "scrittore", "goal": "Spiega la correzione in modo semplice", "depends_on": ["t1", "t2", "t3"]}]}
    if role == "researcher":
        if i == 0:
            return tool_call("search_documents", query="linee guida codice")
        if i == 1:
            return tool_call("note", text="Le linee guida chiedono di gestire gli input vuoti")
        return "Le linee guida chiedono di gestire gli input vuoti [linee-guida.md]."
    if role == "programmer":
        if i == 0:
            return tool_call("ask_agent", agent="analista", question="Quali casi limite devo gestire nella media?")
        if i == 1:
            return tool_call("run_python", code="def media(l):\n    return sum(l) / len(l)\n\nprint(media([2, 4, 6]))")
        if i == 2:
            return "La funzione corretta:\n```python\ndef media(l):\n    return sum(l) / len(l)\n```"
        return "Versione robusta:\n```python\ndef media(l):\n    if not l:\n        raise ValueError('lista vuota')\n    return sum(l) / len(l)\n```"
    if role == "consult":
        return "La lista vuota: len(l) è 0 e si ottiene ZeroDivisionError."
    if role == "analyst":
        if i == 0:
            return tool_call("list_files", path=".")
        return "Casi limite: lista vuota, valori non numerici, numeri molto grandi."
    if role == "writer":
        return "Il bug era il `+1` finale; ora la media è corretta e gestisce la lista vuota."
    if role == "critic":
        user = messages[1]["content"]
        if "Versione robusta" not in user and "Correggi" in user:
            return {"approved": False, "score": 6, "issues": ["Non gestisce la lista vuota"], "suggestion": "Aggiungi un controllo"}
        return {"approved": True, "score": 9, "issues": []}
    return ("## Bug corretto\n\nIl problema era il `+1` aggiunto al risultato.\n\n```python\ndef media(l):\n"
            "    if not l:\n        raise ValueError('lista vuota')\n    return sum(l) / len(l)\n```\n\n"
            "- `media([2, 4, 6])` restituisce **4.0** (verificato eseguendo il codice)\n"
            "- Una lista vuota ora genera un errore chiaro invece di `ZeroDivisionError`\n\n"
            "Come richiesto dalle linee guida del progetto [linee-guida.md].")


if __name__ == "__main__":
    s, _ = temp_settings()
    s.api_token = ""
    s.approval_timeout = 600
    app = create_app(s, llm=FakeLLM(script, delay=float(sys.argv[1]) if len(sys.argv) > 1 else 0.4),
                     embedder=FakeEmbedder())
    uvicorn.run(app, host="127.0.0.1", port=8799, log_level="warning")
