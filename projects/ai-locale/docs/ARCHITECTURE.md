# Architettura e decisioni tecniche

## 1. Obiettivi e vincoli

- **Hardware di riferimento**: portatile HP OMEN 16 — Ryzen 9 8940HX, RTX 5070 Laptop (**8 GB VRAM**), 16 GB RAM, SSD 1 TB, Windows 11.
- **Privacy**: inferenza, documenti, memoria e log restano sul PC. Nessuna chiamata a servizi cloud.
- **Semplicità**: un solo processo Python + llama-server; nessun database esterno da gestire.

## 2. Componenti

| Componente | Tecnologia | Motivazione |
|---|---|---|
| Inferenza | **llama.cpp `llama-server`** (CUDA) | Massimo controllo su VRAM, contesto e slot paralleli; modelli GGUF quantizzati; API compatibile OpenAI; tool calling con `--jinja`. Ollama è un livello in più sopra lo stesso motore. |
| Backend | **Python + Starlette + uvicorn** | Starlette è il nucleo su cui è costruito FastAPI: stesse prestazioni asincrone, meno dipendenze. Le API sono semplici e validate a mano. |
| Frontend | **HTML/CSS/JS ES modules, senza build** | Nessun Node.js richiesto per installare o aggiornare; funziona offline; servito dal backend. Migrabile a React se il progetto cresce. |
| Dati | **SQLite** (WAL) | Conversazioni, run ed eventi, memoria, documenti, impostazioni, vettori. Un solo file → backup banale. |
| Vettori | **SQLite + numpy** | Per uso personale (fino a decine di migliaia di blocchi) la ricerca esaustiva in numpy richiede millisecondi. Qdrant aggiungerebbe un servizio senza benefici a questa scala; `RAG.search` è isolata per poterlo introdurre. |
| Embedding | **nomic-embed-text v1.5** su un secondo llama-server | Piccolo (~146 MB), multilingue sufficiente, gira accanto al modello chat. |

### Docker
Non usato di default. Su un portatile Windows l'accesso alla GPU da Docker passa per WSL2 + NVIDIA Container Toolkit: più parti da configurare e più punti di rottura. L'esecuzione nativa di llama-server su Windows è la configurazione più affidabile per questo hardware. `scripts/start.sh` permette l'avvio su Linux/WSL2.

## 3. Motore multi-agente

1. **Pianificazione** — il Coordinatore produce JSON `{reasoning, direct, tasks[{id, agent, goal, depends_on}]}`. Il piano viene validato: agenti sconosciuti → Scrittore, dipendenze inesistenti rimosse, cicli spezzati, limite `max_tasks`. Se il JSON non è valido si risponde direttamente. Se l'utente ha selezionato documenti, il Ricercatore è sempre coinvolto.
2. **Esecuzione** — ondate di compiti pronti in parallelo (semaforo `parallel_agents`, da allineare a `LLAMA_PARALLEL`). Ogni agente esegue un ciclo *ragiona → strumento → osserva* fino a `max_tool_steps`, poi è forzato a dare il risultato.
3. **Collaborazione** — *lavagna condivisa* con risultati e note (riassunti troncati per non saturare il contesto), strumento `ask_agent` per consultare un collega (max 6 consultazioni per richiesta, senza strumenti per evitare ricorsioni).
4. **Revisione** — il Critico valuta ogni risultato con le prove degli strumenti usati; se lo boccia, l'agente lo rifà con il feedback (max `max_revisions`). Problemi non risolti finiscono sulla lavagna e il Coordinatore deve dichiararli.
5. **Sintesi** — il Coordinatore scrive la risposta finale in streaming.

Tutti gli agenti condividono **un solo modello in VRAM**: cambiano prompt e strumenti. Con 8 GB è l'unica scelta sensata, ed è anche come funzionano i sistemi multi-agente in produzione.

Ogni passaggio emette eventi (SSE) salvati nel database: l'interfaccia li mostra dal vivo e li ripropone riaprendo una conversazione.

## 4. Confronto modelli (8 GB VRAM)

| Modello (GGUF Q4_K_M) | File | Punti di forza | Limiti |
|---|---|---|---|
| **Qwen3-8B** *(predefinito)* | 5.0 GB | Tool calling nativo affidabile, ottimo in coding, buon italiano, modalità *thinking* disattivabile | Contesto nativo 32k |
| Llama 3.1 8B Instruct | ~4.9 GB | Italiano supportato ufficialmente, contesto lungo | Tool calling e coding meno solidi |
| Qwen3-14B | 9.0 GB | Qualità superiore | Non entra in 8 GB: una parte va in RAM → molto più lento. Adatto con GPU da 12 GB+ |
| Qwen3-4B | 2.5 GB | Molto veloce, lascia VRAM per contesto lungo | Ragionamento più debole |

Le dimensioni dei file Qwen3 sono quelle pubblicate nei repository ufficiali su Hugging Face. **Velocità (token/s) e qualità vanno misurate sul PC**: il pannello Sistema e le statistiche di ogni risposta mostrano tempi, chiamate LLM e token/s reali.

Budget VRAM stimato con Qwen3-8B: pesi ~5 GB + cache del contesto (16k token totali) + embedding ~0.2 GB → vicino al limite degli 8 GB. Se compaiono rallentamenti, ridurre `LLAMA_CTX_SIZE`.

## 5. Sicurezza

- Server in ascolto su `127.0.0.1`; l'avvio su altri indirizzi è rifiutato senza `AILOCALE_API_TOKEN`.
- Richieste non locali: token (Bearer o sessione firmata HMAC, cookie HttpOnly/SameSite=Strict), limite di 5 tentativi di login ogni 5 minuti per IP.
- `/api/admin/*` (metriche, log, modelli, backup) **solo dal PC locale**, anche con token.
- Header `Host` verificato (contro il DNS rebinding); header `X-AILocale` obbligatorio sulle scritture (anti-CSRF: un sito esterno non può inviarlo senza CORS, che non è abilitato); CSP restrittiva.
- Strumenti: file solo nella cartella di lavoro (protezione da path traversal); niente file eseguibili; sovrascritture, Python, comandi e salvataggi in memoria richiedono **approvazione esplicita** con anteprima esatta; comandi distruttivi (formattazione, cancellazioni ricorsive di dischi, spegnimento, registro, download+esecuzione…) bloccati sempre; timeout; variabili d'ambiente con segreti rimosse dai processi figli.
- Upload: estensioni consentite, dimensione massima, verifica dei magic number (PDF/DOCX), controllo anti zip-bomb, nomi file sanificati.
- Log senza contenuti delle conversazioni (solo id, tempi, conteggi).
- llama-server ascolta solo su `127.0.0.1` e non è mai esposto.

**Limite dichiarato**: `run_python` e `run_command` non sono una sandbox isolata: girano con i permessi del tuo utente. La protezione è l'approvazione umana + i blocchi. Per un isolamento vero servirebbe un container o un utente Windows dedicato.

## 6. Stato dei requisiti

Completati e coperti da test automatici: motore multi-agente, strumenti e approvazioni, API conversazioni/run/eventi, RAG (PDF, DOCX, testo, codice), memoria, impostazioni, sicurezza, metriche, gestione modelli, log/errori, backup/ripristino.

Non verificati in questo ambiente (nessuna GPU né Windows disponibili durante lo sviluppo):
- script PowerShell (`scripts/*.ps1`);
- esecuzione con llama-server e modelli reali, prestazioni e consumo di VRAM;
- metriche GPU via NVML/nvidia-smi (il codice restituisce "non disponibile" con il motivo se mancano).

Da fare in futuro:
- OCR per PDF scansionati (oggi vengono rifiutati con un messaggio chiaro);
- ricerca web (esclusa di proposito: invierebbe dati all'esterno; andrebbe aggiunta come strumento con consenso esplicito);
- sandbox isolata per l'esecuzione di codice;
- più utenti con permessi separati (oggi: un utente, raccolte di documenti separate).
