"""Server di prova per verificare l'interfaccia senza GPU (usa il modello finto dei test).
NON è la modalità d'uso reale: serve solo per i test visivi dell'interfaccia.

    python tests/ui_demo_server.py [ritardo_secondi]     -> http://127.0.0.1:8799
"""
import sys

import uvicorn

from helpers import FakeEmbedder, FakeLLM, temp_settings, tool_call
from backend.app.main import create_app


MEDIA_PY = """\"\"\"Media aritmetica robusta.\"\"\"


def media(valori: list[float]) -> float:
    \"\"\"Restituisce la media; solleva ValueError se la lista è vuota.\"\"\"
    if not valori:
        raise ValueError("lista vuota")
    return sum(valori) / len(valori)  # niente +1 finale


if __name__ == "__main__":
    print(media([2, 4, 6]))  # 4.0
"""
INDEX_HTML = """<!doctype html>
<html lang="it"><head><meta charset="utf-8"><title>Calcolatrice della media</title>
<style>body{font-family:system-ui;margin:0;display:grid;place-items:center;min-height:100vh;background:#faf7f0;color:#222}
main{background:#fff;padding:32px 36px;border-radius:14px;box-shadow:0 10px 30px rgba(0,0,0,.08);width:min(420px,90vw)}
h1{font-size:22px;margin:0 0 6px}input{width:100%;padding:10px;border:1px solid #ddd;border-radius:8px;font:inherit}
button{margin-top:10px;padding:10px 14px;border:0;border-radius:8px;background:#e2a336;font-weight:600;cursor:pointer}
#out{margin-top:14px;font-size:20px}</style></head>
<body><main><h1>Media di una lista</h1><p>Numeri separati da virgola</p>
<input id="v" value="2, 4, 6"><button id="b">Calcola</button><div id="out"></div></main>
<script>document.getElementById('b').onclick=()=>{const v=document.getElementById('v').value.split(',').map(Number).filter(n=>!isNaN(n));
document.getElementById('out').textContent=v.length?('Media: '+(v.reduce((a,b)=>a+b,0)/v.length)):'Lista vuota';};</script></body></html>
"""
CASI_CSV = """caso,input,atteso,esito
lista normale,"[2, 4, 6]",4.0,ok
un solo valore,[5],5.0,ok
lista vuota,[],ValueError,ok
negativi,"[-2, 2]",0.0,ok
decimali,"[0.1, 0.2]",0.15,ok
grandi,"[1e308, 1e308]",inf,da verificare
"""
README_MD = """# Correzione della funzione `media`

Il bug era il **`+1`** aggiunto al risultato: la media di `[2, 4, 6]` usciva 5 invece di 4.

## Cosa è cambiato

- La funzione restituisce `sum(valori) / len(valori)`.
- Una lista vuota genera un `ValueError` chiaro invece di `ZeroDivisionError`.
- Sei casi limite sono documentati in `casi.csv`.

> Il Critico ha chiesto di gestire la lista vuota prima di approvare.

## Come provarla

```python
from media import media
print(media([2, 4, 6]))  # 4.0
```
"""


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
            return tool_call("write_file", path="media/media.py", content=MEDIA_PY)
        if i == 3:
            return tool_call("write_file", path="media/index.html", content=INDEX_HTML)
        if i == 4:
            return "La funzione corretta:\n```python\ndef media(l):\n    return sum(l) / len(l)\n```"
        return "Versione robusta:\n```python\ndef media(l):\n    if not l:\n        raise ValueError('lista vuota')\n    return sum(l) / len(l)\n```"
    if role == "consult":
        return "La lista vuota: len(l) è 0 e si ottiene ZeroDivisionError."
    if role == "analyst":
        if i == 0:
            return tool_call("list_files", path=".")
        if i == 1:
            return tool_call("write_file", path="media/casi.csv", content=CASI_CSV)
        return "Casi limite: lista vuota, valori non numerici, numeri molto grandi."
    if role == "writer":
        if i == 0:
            return tool_call("write_file", path="media/README.md", content=README_MD)
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
    voice = app.state.svc.voice

    async def fake_transcribe(audio, lang):  # solo per la prova visiva: nessun modello Whisper qui
        return {"text": "Correggi la funzione media e verificala", "language": lang, "duration": 1.0}
    voice.transcribe = fake_transcribe
    voice.status = lambda: {"stt": True, "stt_model": "demo", "tts": False, "tts_voice": None,
                            "hint_stt": None, "hint_tts": None}
    uvicorn.run(app, host="127.0.0.1", port=8799, log_level="warning")
