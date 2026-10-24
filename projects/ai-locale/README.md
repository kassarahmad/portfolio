# AI Locale — Home AI Assistant multi-agente

Un team di agenti AI che gira **interamente sul tuo PC**: un Coordinatore pianifica il lavoro,
cinque agenti specializzati lo eseguono in parallelo usando strumenti reali, un Critico lo
revisiona, e tu approvi ogni azione che tocca il computer. Nessun dato esce dal PC.

```
             ┌──────────────── Coordinatore ────────────────┐
 richiesta → │ piano JSON: compiti, agenti, dipendenze      │
             └──────┬──────────────┬──────────────┬─────────┘
                    ▼              ▼              ▼
              Ricercatore    Programmatore     Analista   …  (in parallelo)
                │  ▲              │  ▲            │
                │  └── ask_agent ─┘  │            │      strumenti: documenti (RAG), file,
                ▼                    ▼            ▼      Python, comandi, memoria
            ┌──────────── Lavagna condivisa ────────────┐
            └──────────────────┬────────────────────────┘
                               ▼
                 Critico: approva o rimanda indietro
                               ▼
                 Coordinatore: risposta finale (streaming)
```

## Funzionalità

| Area | Cosa fa |
|---|---|
| **Team di 9 agenti** | Coordinatore, Ricercatore, Programmatore, Analista, Scrittore, Operatore, Navigatore, Visione, Critico. Pianificano, lavorano in parallelo, si consultano, il Critico fa correggere |
| **Web** | Ricerca aggiornata con fonti, lettura di pagine e PDF online, **browser automatico** che apre siti, clicca e compila moduli (invii solo con approvazione) |
| **Visione** | Analizza foto e screenshot allegati in chat (trascina, incolla o 📎), legge documenti scansionati (OCR) |
| **File e progetti** | Crea interi progetti (cartelle, codice, test), li esegue, legge Word/Excel/PowerPoint/PDF, sposta e rinomina; backup prima di sovrascrivere, cestino invece di cancellare |
| **Ufficio 3D** | Mondo in miniatura con agenti sferici che camminano, si riuniscono, si passano documenti, pensano e festeggiano, guidati dagli eventi reali. Clic su un agente per ispezionarlo, rotazione, zoom, pausa, tutto schermo. Vista 2D e cronologia sempre disponibili |
| **RAG e memoria** | Documenti con citazioni file e pagina, memoria persistente modificabile |
| **Admin** | CPU, RAM, GPU, VRAM, disco reali, modelli, log, errori, backup, **registro di ogni azione degli agenti** |
| **Sicurezza** | Solo locale, approvazioni per azioni rischiose, cartelle autorizzate, protezione SSRF e prompt injection, modalità locale rigorosa |

Stato dettagliato (cosa è testato, cosa va verificato sul PC, cosa manca): [docs/STATO.md](docs/STATO.md).

## Installazione (Windows 11)

Requisiti: Python 3.11+ ([python.org](https://www.python.org/downloads/), spunta *Add to PATH*), driver NVIDIA aggiornato.

```powershell
cd C:\percorso\ai-locale
powershell -ExecutionPolicy Bypass -File scripts\setup.ps1
```

Lo script fa l'audit dell'hardware, crea l'ambiente Python, scarica **llama.cpp con CUDA** e i
modelli adatti alla tua VRAM — chiedendo conferma prima di ogni download — e lancia i test.

## Uso

```powershell
scripts\start.ps1     # avvia e apre http://127.0.0.1:8765
scripts\stop.ps1      # arresta tutto
scripts\backup.ps1    # backup (anche dal pannello Sistema)
scripts\update.ps1    # backup + aggiornamento dipendenze e llama.cpp
```

Nell'interfaccia: scrivi una richiesta, seleziona eventualmente le raccolte di documenti
sopra il campo di testo, e segui gli agenti nella *Stanza degli agenti* a destra. Quando un
agente vuole eseguire codice o un comando, vedi il testo esatto e scegli **Approva** o **Rifiuta**.

## Modello consigliato

Lo script installa **Qwen3-VL-8B-Instruct** (Q4_K_M, ~5 GB) con il suo proiettore visivo `mmproj` (~0,75 GB):
un unico modello che ragiona, usa gli strumenti e vede le immagini, adatto agli 8 GB della RTX 5070 Laptop.
Senza `CHAT_MMPROJ_FILE` il modello funziona solo a testo e la pagina **Strumenti** mostra la visione come non disponibile.

**OCR in italiano con Tesseract**: dopo l'installazione scarica `ita.traineddata` da
github.com/tesseract-ocr/tessdata e copialo in `C:\Program Files\Tesseract-OCR\tessdata`.

## Cartelle dei tuoi progetti

Per far lavorare gli agenti sui tuoi progetti reali aggiungi nel `.env`:
`AILOCALE_ALLOWED_PATHS=C:\Users\Ahmad\Progetti`. Fuori da queste cartelle non possono leggere né scrivere.

## Progetti, artefatti e sessioni

- **Progetti**: nome, colore, descrizione e istruzioni per gli agenti. Ogni progetto ha una sua cartella di
  lavoro (`data/workspace/progetti/<nome>`) e una sua base di conoscenza: i documenti caricati nella pagina del
  progetto vengono consultati in ogni sessione del progetto.
- **Artefatti**: i file creati o modificati dal team durante una risposta (documenti, codice, pagine HTML,
  CSV/Excel, immagini, PDF, zip) vengono registrati e si aprono nel pannello accanto alla chat: anteprima delle
  pagine HTML in un riquadro isolato (senza accesso all'app né alla rete), codice con numeri di riga, tabelle,
  documenti con tipografia da lettura. La pagina **Artefatti** li raccoglie tutti, con filtri e ricerca.
- **Sessioni**: le conversazioni nella barra laterale, raggruppate per data, con il colore del progetto e un
  indicatore per quelle in corso. Una sessione si può spostare in un progetto dal titolo in alto.

Scorciatoie: `Ctrl+Shift+O` nuova chat, `Ctrl+K` cerca sessioni, `Ctrl+B` mostra/nasconde la barra, `Esc` chiude
il visualizzatore.

## Modalità autonoma

In **Impostazioni → Modalità autonoma** le azioni rischiose (scrivere o sovrascrivere file, eseguire
codice e comandi) non le approvi più tu: le approva il **Critico** come garante, che legge la tua
richiesta e l'azione e decide. Ogni decisione, con il motivo, resta nella cronologia e nell'audit.

Restano sempre attivi, anche in modalità autonoma:
- i comandi distruttivi bloccati (formattare, cancellare dischi, spegnere il PC, leggere il `.env`…);
- solo cartelle autorizzate; la cartella di installazione di AI Locale e i file di credenziali sono protetti;
- le cancellazioni vanno nel cestino di AI Locale e le sovrascritture salvano un backup;
- dopo aver letto pagine web, i comandi che contattano siti esterni sono bloccati;
- inviare moduli o scrivere nei campi dei siti web chiede comunque a te.

Il Critico controlla anche il lavoro con regole fisse: approva solo ciò che risulta dall'output reale
degli strumenti; "verificato manualmente" senza prova viene rimandato indietro.

## Configurazione

Tutto in `.env` (vedi `.env.example`). Le opzioni di comportamento del team (temperatura,
agenti in parallelo, revisioni, passi massimi…) si cambiano da **Impostazioni**.

**Per il tuo portatile (RTX 5070 Laptop, 8 GB VRAM)** la configurazione predefinita è:
Qwen3-8B Q4_K_M (~5 GB), contesto 16k diviso su 2 slot paralleli, embedding nomic (~146 MB).
Se il pannello Sistema mostra la VRAM piena, riduci `LLAMA_CTX_SIZE` a 12288.

### Accesso da fuori casa (opzionale)
1. Installa [Tailscale](https://tailscale.com) sul PC e sul telefono.
2. Nel `.env`: `AILOCALE_API_TOKEN=` un token lungo e casuale, `AILOCALE_HOST=` l'IP Tailscale
   del PC (100.x.y.z), e aggiungilo a `AILOCALE_ALLOWED_HOSTS`.
3. Dal telefono apri `http://100.x.y.z:8765` e inserisci il token.

Il pannello di amministrazione resta comunque accessibile **solo dal PC**. Non aprire porte sul router.

## Test

```powershell
.venv\Scripts\python -m unittest discover -s tests -v
```

I test usano un modello finto e deterministico (`tests/helpers.py`), quindi verificano la logica
(orchestrazione, sicurezza, API, RAG, backup) senza GPU. La qualità delle risposte reali dipende
dal modello e va valutata sul PC.

## Struttura

```
backend/app/
  main.py          API web e avvio
  orchestrator.py  motore multi-agente (piano, esecuzione, critico, sintesi, approvazioni)
  agents.py        definizione del team (aggiungi qui nuovi agenti)
  tools/           strumenti degli agenti e regole di sicurezza
  llm.py           client per llama-server / API compatibili OpenAI
  rag.py           estrazione, chunking, embedding, ricerca
  system.py        metriche hardware, gestione llama-server, log, backup
  security.py      accesso locale/remoto, CSRF, header di sicurezza
  db.py, config.py, cli.py
frontend/          interfaccia (HTML/CSS/JS senza build, funziona offline)
  office3d.js      ufficio 3D (three.js incluso in vendor/, licenza MIT)
  office.js        ufficio 2D
scripts/           setup, avvio, arresto, backup, aggiornamento
tests/             test automatici
docs/              architettura e decisioni tecniche
```

Dettagli tecnici, confronto dei modelli e limiti noti: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).
