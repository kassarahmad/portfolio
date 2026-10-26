# Stato delle funzionalità, test e sicurezza

Aggiornato al 26/10/2026 (milestone M0, M3, M4).

## M0 - Coerenza del registro strumenti (26/10/2026)

Due difetti corretti, entrambi della stessa famiglia: **strumenti dichiarati che nessuno poteva usare**.

1. **Immagini e video.** `backend/app/media.py` e tre strumenti (`generate_image`, `generate_video_clip`,
   `make_video`) erano registrati ma irraggiungibili: nessun agente li aveva in lista, `ctx.media` non
   veniva mai valorizzato e `MediaStudio` non veniva mai costruito. La pagina Strumenti li mostrava
   comunque come *attivi*. Il modulo e' stato **spostato in `wip/media.py`** (conservato, non eliminato)
   e le registrazioni rimosse. Torneranno con M2 (immagini locali) e M3 (montaggio video con ffmpeg).
2. **Memoria.** Lo strumento `remember` era registrato ma non assegnato a nessun agente, mentre
   l'interfaccia prometteva che *"gli agenti possono proporre di salvarne di nuove"*. Ora e' in
   `COMMON_TOOLS` e resta **sempre approvato dall'utente**, anche in modalita' autonoma.

Protezione contro le recidive: `tests/test_tools.py::RegistryCoherenceTest` fallisce se uno strumento
registrato non appartiene a nessun agente, se un agente cita uno strumento inesistente o se un campo
del `ToolContext` non viene mai valorizzato dall'orchestratore.

Test: **84 superati** (81 di baseline + 3 nuovi), eseguiti su Linux. Windows, GPU e voce reale restano
da verificare sul PC.

## M3 - Montaggio video locale (26/10/2026)

Nuovo modulo `backend/app/video.py` e nuovo agente **Montatore**. Monta un vero MP4 sul PC a partire
da scene di testo e immagini: zoom lento alternato, voce narrante Piper, sottotitoli impressi e file
`.srt` + `.vtt` con tempi globali. Nessun servizio esterno, nessuna API a pagamento.

- Strumenti: `make_video` (produce) e `video_info` (misura). Il Montatore deve **sempre** misurare il
  file prodotto: il Critico basato sulle prove rifiuta un "video creato" senza la misura.
- ffmpeg arriva da `imageio-ffmpeg` (in `requirements.txt`). `ffprobe` e' **facoltativo**: se manca
  (Windows con il solo pacchetto Python) la misura viene letta dall'intestazione che stampa ffmpeg.
- Limiti: 40 scene, 15 minuti, 120 s per scena. Le immagini passano dagli stessi controlli di percorso
  degli altri strumenti; sovrascrivere un video esistente richiede approvazione.
- L'interfaccia riconosce i tipi `video`, `audio` e `subtitles`: il video si guarda nel visualizzatore
  degli artefatti, il `.srt` si legge accanto.

**La generazione AI di immagini e clip non fa parte di M3**: resta in `wip/media.py` per M2.

## M4 - Archivi sicuri (26/10/2026)

Nuovo modulo `backend/app/archive.py` e tre strumenti per Operatore e Programmatore: `create_archive`,
`inspect_archive`, `extract_archive` (.zip, .tar, .tar.gz/.bz2/.xz).

Un archivio e' **dato non fidato**. Prima di scrivere un solo byte vengono rifiutati: percorsi che
risalgono (`../`, zip-slip), percorsi assoluti, lettere di unita' (`C:\...`), nomi con byte nullo,
collegamenti simbolici nei tar, archivi corrotti, oltre 20.000 voci, oltre 4 GB estratti, singole voci
oltre 2 GB e rapporti di espansione sopra 200x ("zip bomb"). Se **una sola** voce e' sospetta non si
estrae nulla. Il rapporto si misura su quanto l'archivio si espande, non su quanto pesa: 60 MB di zeri
stanno in 60 KB, e un limite sul compresso li lascerebbe passare.

L'estrazione richiede approvazione (dell'utente o, in modalita' autonoma, del Critico) e all'Operatore
e' chiesto di ispezionare sempre prima di estrarre.

## Test eseguiti in M3 e M4

**134 superati** su Linux (84 dopo M0, +25 video, +25 archivi), eseguiti davvero, non dichiarati:

- `tests/test_video.py` produce MP4 reali e li rimisura con ffprobe (durata, risoluzione, fps, codec,
  peso), verifica i tempi globali dei sottotitoli, la misura senza ffprobe, l'immagine mancante
  segnalata invece che nascosta, i limiti, la pulizia dei file temporanei e i confini della cartella.
- `tests/test_archive.py` costruisce archivi **davvero malevoli** (zip-slip, percorso assoluto,
  `C:\Windows\...`, symlink in un tar, bomba da 60 MB in 60 KB) e verifica che vengano rifiutati, piu'
  i giri completi zip e tar.gz.
- Verifica visiva in Chromium: il video prodotto si riproduce nel visualizzatore (9:16, sottotitoli
  impressi, 0:04) con il `.srt` elencato accanto, e la decima scrivania del Montatore compare
  nell'ufficio 2D senza errori di pagina.

Restano da verificare **sul tuo PC**: Windows, GPU, e la voce reale (Whisper + Piper) con
`scripts\voice.ps1` - qui la voce non e' installata, quindi i video di prova sono senza parlato.

## Legenda
- ✅ **Funziona e testato** qui con test automatici o con un vero browser
- 🟡 **Implementato, da verificare sul tuo PC** (serve GPU, modelli reali o Windows)
- ❌ **Non presente** (roadmap)

## Funzionalità

| Area | Stato | Note |
|---|---|---|
| Motore multi-agente (piano, parallelo, dipendenze, lavagna, consultazioni, Critico) | ✅ | 11 test con modello finto deterministico |
| Qualità reale delle risposte | 🟡 | Dipende dal modello (Qwen3-VL-8B consigliato): da valutare sul PC |
| 10 agenti: Coordinatore, Ricercatore, Programmatore, Analista, Scrittore, Operatore, **Navigatore**, **Visione**, **Montatore**, Critico | ✅ | Ognuno con strumenti, prompt e stato propri |
| File e progetti: leggere, cercare, creare cartelle/file, sovrascrivere con diff+backup, spostare, cestino | ✅ | Solo cartella di lavoro + cartelle autorizzate |
| Lettura PDF, DOCX, XLSX, PPTX, CSV | ✅ | |
| Esecuzione Python e comandi con approvazione | ✅ | Bloccati comandi distruttivi e lettura `.env` |
| Ricerca web (DuckDuckGo o SearXNG) e lettura pagine/PDF online | ✅ / 🟡 | Parser e protezioni testati; la connessione reale a Internet va provata sul PC |
| Browser automatico (apri, clicca, scrivi, indietro, screenshot) | ✅ | Testato con un vero Chromium su un sito locale; invii di moduli con approvazione, password vietate |
| Analisi immagini (allegati in chat, screenshot) | ✅ / 🟡 | Flusso testato con modello finto; serve Qwen3-VL + mmproj sul PC |
| OCR di PDF scansionati e immagini | ✅ | Testato con Tesseract; in alternativa usa il modello di visione |
| RAG con citazioni file+pagina, raccolte, aggiornamenti, embedding locali | ✅ | |
| Memoria persistente controllabile | ✅ | |
| Ufficio 3D (three.js) con agenti sferici animati | ✅ | Verificato in Chromium (rendering software); fluidità a 60 FPS da verificare sulla RTX 5070 |
| Ufficio 2D e cronologia eventi | ✅ | |
| Dashboard: CPU, RAM, GPU, VRAM, disco, servizi, modelli, log, errori, backup, registro azioni | ✅ / 🟡 | Metriche GPU reali solo con driver NVIDIA (qui "non disponibile", come previsto) |
| Avvio/arresto llama-server con mmproj dal pannello | 🟡 | Da verificare su Windows |
| Script PowerShell (setup, start, stop, backup, update) | 🟡 | Scritti con cura, non eseguibili in questo ambiente |
| Modalità locale rigorosa (nessun LLM cloud) | ✅ | |
| Email, calendario, Drive, Slack, WhatsApp | ❌ | Roadmap: connettori disattivati per default con OAuth e conferma d'invio |
| Audio (trascrizione, voce) | 🟡 | faster-whisper + Piper integrati; da verificare sul PC con `scripts\voice.ps1` |
| Montaggio video locale con sottotitoli SRT/VTT | ✅ | MP4 prodotti e rimisurati con ffprobe nei test |
| Archivi .zip/.tar sicuri (crea, ispeziona, estrai) | ✅ | Testati contro zip-slip, percorsi assoluti, symlink e zip bomb |
| Generazione AI di immagini e video | ❌ | M2: `wip/media.py` pronto, servono i modelli (~8 GB) |
| Automazione di app desktop native di Windows | ❌ | Roadmap: richiede uno strumento tipo pywinauto e test dedicati |
| Sandbox isolata per il codice | ❌ | Oggi: approvazione umana + blocchi + timeout. Roadmap: container/utente dedicato |
| Agenti Security, DevOps, Database, Audio | ❌ | Roadmap (si aggiungono in `agents.py`) |

## Test eseguiti (58, tutti superati)

- `test_llm.py` — streaming, tool calling a pezzi, fallback senza streaming, errori di rete, `<think>`.
- `test_orchestrator.py` — risposta diretta, team completo con dipendenze e revisione, approvazione/rifiuto, strumenti non consentiti, piano non valido, LLM spento, annullamento, cicli, limite passi.
- `test_api.py` — sicurezza (CSRF, host, remoto con token, rate limit, header), conversazioni, chat SSE, documenti, memoria, impostazioni, metriche reali, modelli, backup/ripristino.
- `test_tools.py` — progetti (crea, sovrascrive con diff e backup, sposta, cestino), cartelle autorizzate, percorsi vietati, Excel/PowerPoint, ricerca web e pagine con contenuto marcato non attendibile, SSRF, **browser reale** con link, moduli, password vietate, screenshot, visione, **OCR reale** di immagine e PDF scansionato, allegati in chat fino all'agente Visione, registro di audit, modalità locale rigorosa.

Verifica visiva: interfaccia, ufficio 2D e ufficio 3D aperti in Chromium (chiaro/scuro, italiano/inglese, mobile), richiesta completa registrata in video.

## Rapporto di sicurezza

| Rischio | Protezione |
|---|---|
| Accesso dall'esterno | Server su 127.0.0.1; remoto solo con token via VPN; pannello admin sempre solo locale |
| Siti malevoli che chiamano l'API locale | Header anti-CSRF obbligatorio, controllo Host (DNS rebinding), CSP |
| Prompt injection da pagine web | Contenuto web marcato come non attendibile; le azioni pericolose richiedono comunque l'approvazione umana, che il modello non può concedersi |
| Agente che accede a servizi locali (SSRF) | Web e browser bloccano IP locali e privati, anche dopo i redirect |
| Danni ai file | Solo cartelle autorizzate; backup prima di sovrascrivere; "elimina" = cestino; niente eseguibili né `.env` |
| Comandi distruttivi | Approvazione con testo esatto + blocco di formattazioni, cancellazioni di dischi, spegnimento, registro, download+esecuzione |
| Credenziali | Mai nel codice; variabili con TOKEN/SECRET/KEY rimosse dai processi figli; gli agenti non scrivono password nei siti |
| Cloud non autorizzato | `STRICT_LOCAL=true` rifiuta server LLM non locali |
| Tracciabilità | Registro di audit di ogni strumento usato (agente, argomenti, esito) |

## Requisiti hardware per modello (stime)

| Modello | VRAM (pesi + contesto 16k) | Uso |
|---|---|---|
| Qwen3-VL-8B Q4_K_M + mmproj Q8_0 | ~7 GB | **Consigliato** sul tuo portatile (8 GB): testo, strumenti, visione |
| Qwen3-VL-4B Q4_K_M + mmproj | ~4 GB | GPU da 4-6 GB o più velocità |
| Qwen3-14B Q4_K_M (solo testo) | ~10.5 GB | GPU da 12 GB+, nessuna visione |
| nomic-embed-text v1.5 Q8_0 | ~0.3 GB | Ricerca semantica nei documenti |
