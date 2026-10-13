// Traduzione italiana. Stessa struttura dei contenuti inglesi in src/content;
// la build si ferma se manca una frase. Nomi di tecnologie e codice restano invariati.

const L = null; // posizione del livello di verifica nelle tuple: resta quello inglese

export default {
  profile: {
    role: "Software engineer: sviluppo full-stack, integrazione AI, Linux e infrastruttura cloud",
    availability: "Disponibile per ruoli junior in Italia o da remoto",
    location: "Ancona, Italia",
    lede:
      "Costruisco software che le aziende usano ogni giorno: in Hyperlean un assistente RAG che risponde agli ingegneri partendo dalla loro documentazione tecnica, " +
      "per una pizzeria di Ancona una piattaforma di ordini con regole nel database e assistente AI, e servizi che metto in produzione io stesso con Docker su Linux e AWS. " +
      "Laurea in Informatica all'Università di Camerino; ora iscritto alla magistrale.",
    about: [
      "Mi piace la parte del software che inizia dopo che la demo funziona: rendere affidabili le risposte, tenere i costi prevedibili, decidere cosa succede quando un servizio esterno cade, e poter rifare il deploy domani. In Hyperlean questo ha voluto dire ripulire la documentazione PDF ed Excel prima che arrivasse al modello, mettere limiti per utente su un'API a pagamento e insegnare all'assistente a dire quando non sa. Per un ristorante ha voluto dire far rispettare prezzi e stati degli ordini nel database, così un browser manomesso non può cambiarli.",
      "Ho lavorato soprattutto per piccole e medie imprese: un'azienda di software industriale, un ristorante che riceve ordini ogni sera, un'agenzia che risponde alle famiglie in tre lingue, un marchio che vende strumenti AI. Cerco un ruolo junior in sviluppo full-stack, backend, AI o platform engineering, dove continuare a imparare da chi gestisce sistemi più grandi dei miei.",
    ],
    languages: [
      ["Arabo", "madrelingua"],
      ["Italiano", "C1, professionale"],
      ["Inglese", "B2, professionale"],
      ["Francese", "B1, livello di lavoro"],
    ],
  },
  skillGroups: [
    {
      title: "Linguaggi",
      items: [
        ["Python", L, "Backend RAG di Hyperlean (FastAPI); agente di Hostwatch"],
        ["TypeScript / JavaScript", L, "Edge function di Buon Gusto e Prontix; Slotbook, Hostwatch"],
        ["SQL e PL/pgSQL", L, "Buon Gusto: 25 funzioni nel database, vincoli e policy di accesso"],
        ["VB.NET", L, "Integrazione nel client desktop di Hyperlean"],
        ["Java, C++", L, "Corsi universitari e corsi online"],
      ],
    },
    {
      title: "AI e dati",
      items: [
        ["Retrieval-augmented generation", L, "Assistente Hyperlean; risposte di Buon Gusto basate su menu e ordini"],
        ["OpenAI API, embedding", L, "Hyperlean, Buon Gusto, Prontix; modello di riserva"],
        ["Database vettoriale Qdrant", L, "Hyperlean: collection per documenti, sviluppo e glossario"],
        ["Ingestion di documenti (PDF, Excel)", L, "Pipeline di estrazione e normalizzazione di Hyperlean"],
        ["Controllo di costi e abusi", L, "Quote su Redis in Hyperlean; limiti su Postgres in Buon Gusto"],
      ],
    },
    {
      title: "Backend",
      items: [
        ["FastAPI", L, "API RAG di Hyperlean con ruoli e health check"],
        ["PostgreSQL", L, "Buon Gusto (Postgres 17); Slotbook (Postgres 16, migrazioni proprie)"],
        ["Supabase: Auth, RLS, Edge Functions", L, "Buon Gusto, Prontix"],
        ["API REST e OpenAPI", L, "Hyperlean (Swagger UI); Slotbook, Hostwatch"],
        ["Redis", L, "Rate limit e quote di token per utente in Hyperlean"],
        ["Tempo reale: SSE, Web Push", L, "Notifiche di Buon Gusto; flusso live di Hostwatch"],
      ],
    },
    {
      title: "Linux, cloud e delivery",
      items: [
        ["AWS EC2, security group", L, "Backend e Qdrant di Hyperlean; runbook di Shipyard"],
        ["Docker e Docker Compose", L, "Qdrant in Hyperlean; stack di produzione di Shipyard"],
        ["Hardening Linux (UFW, SSH, aggiornamenti)", L, "Host EC2 di Hyperlean; bootstrap di Shipyard"],
        ["CI/CD con GitHub Actions", L, "Shipyard: test, scansioni, approvazione manuale, rollback"],
        ["Netlify", L, "Buon Gusto (dominio proprio), Prontix, Stepvia, questo sito"],
      ],
    },
  ],
  experience: [
    {
      when: "2026 – oggi",
      title: "Sviluppatore software, progetti per clienti",
      org: "Pizzeria Buon Gusto, Prontix, Stepvia International Education",
      points: [
        "Ho progettato e realizzato la piattaforma di ordini e il gestionale della Pizzeria Buon Gusto: Supabase Postgres con 14 tabelle, row-level security su ogni tabella, prezzi calcolati sul server, una macchina a stati degli ordini imposta dal database, magazzino, fasce orarie e zone di consegna.",
        "Ho aggiunto un assistente OpenAI che risponde solo da menu, magazzino e ordini in tempo reale, con modello di riserva e limiti contro gli abusi; notifiche push ed email a ogni cambio di stato; chat live che passa il cliente allo staff.",
        "Ho realizzato il sito e l'area clienti di Prontix (accesso con Google ed email, caricamento documenti, domande a credito sui documenti del cliente) e il sito di Stepvia in inglese, francese e arabo.",
      ],
    },
    {
      when: "ott 2025 – mar 2026",
      title: "Sviluppatore di chatbot AI e software",
      org: "Hyperlean S.r.l.",
      points: [
        "Ho progettato e sviluppato un assistente virtuale RAG per un applicativo industriale di stima dei costi e preventivazione: backend FastAPI, database vettoriale Qdrant e modelli OpenAI, integrato nel client desktop VB.NET esistente.",
        "Ho costruito la pipeline di ingestion per documentazione PDF, Excel e testuale (estrazione, normalizzazione, chunking, embedding), correggendo l'estrazione rumorosa di PDF e fogli di calcolo che peggiorava il retrieval.",
        "Ho messo in produzione su AWS EC2 con Docker e sicurezza a più livelli (security group, API key, UFW); ho aggiunto rate limit per utente e quote giornaliere di token su Redis, modello di riserva, limiti sulle risposte e un endpoint di health check.",
        "Ho aggiunto un glossario tecnico multilingua applicato dopo la generazione, basi di conoscenza separate per produzione e sviluppo, e ho valutato l'assistente con prove conversazionali guidate. Il progetto è diventato la mia tesi di laurea.",
      ],
    },
    {
      when: "set 2024 – feb 2025",
      title: "Sviluppatore software",
      org: "Food & More di Mahfouz Oussama S.A.S.",
      points: [
        "Ho lavorato a un'applicazione per la gestione degli ordini: analisi dei requisiti, funzionalità principali, test funzionali e debugging.",
        "Ho realizzato interfacce web in HTML, CSS e JavaScript, integrato un database relazionale e gestito il codice con Git.",
      ],
    },
  ],
  education: [
    {
      when: "lug 2026 – oggi",
      title: "Laurea magistrale in Computer Science (LM-18)",
      org: "Università di Camerino",
      note: null,
    },
    {
      when: "2023 – 2026",
      title: "Laurea triennale in Informatica (L-31)",
      org: "Università di Camerino",
      note: "Tesi: «Progettazione e valutazione sperimentale di un assistente virtuale RAG per il supporto a uno strumento di preventivazione in ambito industriale». Relatore Prof. Lorenzo Rossi.",
    },
  ],
  certifications: [
    { title: "Java Programming and Software Engineering Fundamentals", org: "Duke University su Coursera" },
    { title: "Beginning C++ Programming – From Beginner to Beyond", org: "Corso online" },
  ],
  projects: {
    "hyperlean-rag-assistant": {
      title: "Assistente RAG per la stima dei costi industriali",
      summary:
        "Un assistente virtuale sviluppato in Hyperlean che risponde alle domande su un applicativo industriale di stima dei costi e preventivazione usando solo la sua documentazione, in produzione su AWS con controllo di costi e abusi. È anche la mia tesi di laurea.",
      status: "Consegnato in Hyperlean",
      role: "Sviluppatore: backend RAG, pipeline di ingestion, integrazione desktop, deploy su AWS, valutazione",
      org: "Hyperlean S.r.l.",
      problem:
        "Gli ingegneri che stimano i costi di produzione lavorano dentro un applicativo desktop tecnico, pieno di parametri, regole di validità e passi di configurazione. La conoscenza che serve esiste, ma è sparsa tra manuali PDF, tabelle Excel di parametri e note operative, quindi ogni dubbio significa interrompere il lavoro per cercare. Un chatbot generico risponderebbe con sicurezza ma senza alcun legame con la documentazione aziendale, e nella stima dei costi un parametro inventato può cambiare un preventivo. L'obiettivo era un assistente dentro l'applicativo che risponda dalla documentazione e dica chiaramente quando la risposta non c'è.",
      users: [
        "Gli utenti dell'applicativo di stima dei costi e preventivazione che hanno bisogno di procedure, definizioni e passi di configurazione mentre lavorano.",
        "Gli amministratori che curano la base di conoscenza e il glossario tecnico.",
      ],
      features: [
        "Domande poste dall'interno dell'applicativo desktop VB.NET esistente, con gli ultimi scambi conservati come contesto della conversazione.",
        "Risposte basate sui passaggi recuperati dalla documentazione (Retrieval-Augmented Generation), con passi numerati per le procedure.",
        "Una risposta esplicita «non è nella documentazione» per le domande fuori dalla base di conoscenza, invece di un'ipotesi.",
        "Ingestion di documenti PDF, Excel e testuali con un'unica pipeline: estrazione, pulizia, chunking, embedding, salvataggio in Qdrant.",
        "Risposte nella lingua della domanda; un glossario tecnico controllato mantiene coerenti i termini di dominio tra le lingue.",
        "Ruoli separati per domande e amministrazione, basi di conoscenza separate per produzione e sviluppo, e un endpoint che verifica tutte le dipendenze.",
      ],
      diagram: {
        title: "Architettura dell'assistente RAG",
        caption:
          "Il client desktop parla solo con il backend. Chiavi, retrieval, prompt e limiti stanno tutti sul server, quindi l'assistente può cambiare senza distribuire un nuovo client.",
      },
      decisions: [
        {
          title: "Il client non tocca mai il modello né il database",
          body: "I primi prototipi chiamavano l'API del modello direttamente dal client desktop. Il progetto finale ha spostato tutto dietro FastAPI: il client invia una domanda con una API key e riceve una risposta. Le chiavi di OpenAI e Qdrant restano sul server, e le modifiche a chunking, prompt o retrieval arrivano a tutti gli utenti senza un nuovo rilascio del client.",
        },
        {
          title: "Prima la qualità dei dati",
          body: "L'estrazione grezza dei PDF produceva parole spezzate, intestazioni ripetute e spaziature casuali; quella degli Excel produceva righe di celle vuote `| | |`. Entrambe sporcavano gli embedding. Un estrattore PDF pagina per pagina con normalizzazione e un estrattore Excel che riscrive le righe come frasi `campo: valore` hanno reso il retrieval nettamente più pertinente. La lezione principale della tesi è che la qualità delle risposte si decide in fase di ingestion, prima ancora del modello.",
        },
        {
          title: "Dire «non lo so» è una funzionalità",
          body: "Il prompt di sistema consente risposte solo dal contesto recuperato e chiede al modello di dichiarare quando la documentazione non copre la domanda. Nella valutazione, una domanda sul prezzo della licenza, che la documentazione non contiene, ha ricevuto una dichiarazione esplicita del limite invece di un numero plausibile.",
        },
        {
          title: "Costi controllati nel backend, non con la speranza",
          body: "Un modello economico gestisce le domande ordinarie, con uno più forte come riserva. L'output ha un tetto (da 300 a 600 token, in base a un livello di verbosità). Redis applica 20 domande per utente ogni due ore e una quota giornaliera di token per utente; l'ingestion degli amministratori non è soggetta a questi limiti. Budget e modelli consentiti presso il fornitore sono una protezione aggiuntiva, non l'unico controllo.",
        },
        {
          title: "Terminologia corretta dopo la generazione, non con il prompt",
          body: "Le prove multilingua mostravano la lingua giusta ma termini tecnici instabili, metà in inglese e metà tradotti. Invece di forzare il prompt, una collection separata in Qdrant contiene le coppie di termini approvate per lingua e cliente; dopo la generazione, i termini trovati vengono sostituiti in modo deterministico. Gli ID dei record derivano da cliente, lingua e termine, quindi ricaricare un CSV aggiorna le voci invece di duplicarle.",
        },
        {
          title: "Difesa a livelli su AWS",
          body: "Qdrant gira self-hosted in Docker su EC2, dopo un prototipo su Qdrant Cloud. L'accesso è limitato tre volte: il security group (SSH da un solo indirizzo, Qdrant solo da indirizzi autorizzati), una API key obbligatoria su Qdrant e un firewall UFW che nega tutto per impostazione predefinita sull'host, con aggiornamenti regolari e snapshot del volume per il ripristino.",
        },
      ],
      code: { caption: "Rate limit per utente con Redis (logica dalla tesi, Python)" },
      testing:
        "Valutato con conversazioni guidate sugli usi reali dell'applicativo: una procedura passo per passo, una definizione di dominio, la configurazione di una strategia di analisi, una sintesi in tre punti, una domanda fuori ambito e domande in inglese e francese. Ogni risposta è stata giudicata per pertinenza, chiarezza, operatività, completezza, comportamento in assenza di informazioni e coerenza linguistica. La domanda fuori ambito è stata gestita senza inventare; le prove di lingua hanno fatto emergere il problema di terminologia che ha portato al glossario. La tesi dichiara esplicitamente che si tratta di una valutazione qualitativa su un insieme mirato di casi, non di una misura su larga scala.",
      deployment:
        "Backend FastAPI e Qdrant self-hosted in Docker su AWS EC2; Redis per i contatori; configurazione e segreti da variabili d'ambiente; collection separate per produzione e sviluppo, così i nuovi documenti si provano senza toccare gli utenti; `/health` verifica API, OpenAI, Qdrant e la collection configurata. La crescita dello spazio è stimata dal numero di vettori salvati (1.536 dimensioni × 4 byte × un fattore di overhead) e riportata dopo ogni test di ingestion.",
      limitations: [
        "La qualità della risposta dipende dal retrieval: se il passaggio giusto non viene recuperato, nemmeno un modello forte può rimediare.",
        "Dimensione dei chunk, overlap e regole di pulizia vanno tarati per ogni tipo di documento.",
        "La valutazione è qualitativa e limitata a casi rappresentativi; non ci sono ancora metriche automatiche di qualità.",
        "Codice sorgente e schermate appartengono all'azienda e non sono mostrati qui.",
      ],
      roadmap: [
        "Metriche automatiche di qualità e un insieme fisso di domande di regressione.",
        "Cache per domande ed embedding frequenti; collection per più clienti.",
        "Una beta con un gruppo più ampio di utenti per raccogliere domande reali e ambigue.",
        "Retrieval limitato ai documenti nella lingua della domanda.",
      ],
      contribution:
        "Realizzato durante il mio lavoro in Hyperlean S.r.l. (ottobre 2025 – marzo 2026) e presentato come tesi di laurea triennale in Informatica all'Università di Camerino: «Progettazione e valutazione sperimentale di un assistente virtuale RAG per il supporto a uno strumento di preventivazione in ambito industriale» (relatore Prof. Lorenzo Rossi, correlatrice Prof.ssa Irene Cappelli). L'applicativo supportato non viene nominato, come nella tesi.",
      ledger: [
        ["Architettura: client VB.NET, FastAPI, Qdrant su EC2, OpenAI", L, "Tesi, capitolo 4"],
        ["Correzioni all'estrazione di PDF ed Excel e loro effetto sul retrieval", L, "Tesi 4.2, figure da 4.2 a 4.4"],
        ["Rate limit su Redis, quota giornaliera di token, limiti sull'output, modello di riserva", L, "Tesi 4.7"],
        ["Glossario come post-processing deterministico con ID idempotenti", L, "Tesi 5.2.7"],
        ["Domanda fuori ambito gestita senza inventare", L, "Tesi, esperimento 5"],
        ["Realizzato in Hyperlean S.r.l.", L, "CV; dichiarato da Ahmad"],
        ["Codice sorgente", L, "Proprietà dell'azienda, non disponibile"],
      ],
    },
    "buongusto-aspio": {
      title: "Pizzeria Buon Gusto",
      summary:
        "Ordini online, gestionale per lo staff e un assistente AI per una pizzeria con forno a legna ad Aspio, Ancona, online sul proprio dominio.",
      status: "In produzione",
      role: "Sviluppatore: database, edge function, web app, deploy",
      problem:
        "La pizzeria riceveva gli ordini al telefono e su WhatsApp in una fascia serale breve e affollata. Volevano che i clienti potessero ordinare dal telefono per ritiro, al tavolo o con consegna, vedere se l'ordine era stato accettato e avere risposte sul menu senza chiamare, mentre lo staff aveva un'area separata per gestire ordini, menu, magazzino e consegne.",
      users: [
        "Clienti della zona di Ancona che ordinano per il ritiro, al tavolo o con consegna.",
        "Lo staff della pizzeria, che accetta o rifiuta gli ordini, assegna i rider e gestisce il magazzino da un'area che i clienti non vedono mai.",
      ],
      features: [
        "Registrazione con codice via email o Google; profilo, indirizzo salvato e cancellazione dell'account gestiti dal cliente.",
        "Ordini per ritiro, tavolo o consegna in fasce da 15 minuti, con zone di consegna per CAP, ordine minimo, costo di consegna e capienza per fascia.",
        "Un flusso di stati che il cliente segue in tempo reale: ricevuto, accettato, pronto, in consegna, completato, oppure rifiutato con il motivo.",
        "Notifiche push ed email con il marchio della pizzeria a ogni cambio di stato; avvisi push allo staff per nuovi ordini e richieste di assistenza.",
        "Prodotti segnati come finiti automaticamente quando un ingrediente si esaurisce, o disattivati per un solo giorno.",
        "Un assistente che risponde su menu, allergeni, consegne e sugli ultimi ordini del cliente, con un pulsante per parlare con una persona.",
      ],
      diagram: {
        title: "Architettura di Buon Gusto: app nel browser, servizi Supabase, fornitori esterni",
        caption:
          "Clienti e staff usano la stessa web app; ogni scrittura passa da una funzione del database, e i cambi di stato degli ordini generano notifiche tramite un webhook del database.",
      },
      decisions: [
        {
          title: "Le regole di business stanno nel database, non nel browser",
          body: "I clienti non hanno diritti di inserimento o modifica sugli ordini. Chiamano `place_order`, una funzione `SECURITY DEFINER` con `search_path` fissato, che ignora qualsiasi prezzo inviato dal browser e ricalcola ogni riga da menu e aggiunte, poi verifica orari di apertura, zona di consegna per CAP, preavviso, capienza della fascia, ordine minimo e disponibilità degli ingredienti. Un browser manomesso non può cambiare un prezzo né ordinare qualcosa di esaurito.",
        },
        {
          title: "Lo stato dell'ordine è una macchina a stati con lock sulla riga",
          body: "`set_order_status` verifica `is_staff()`, blocca la riga dell'ordine con `SELECT … FOR UPDATE` e consente solo le transizioni elencate nella funzione (per esempio, solo gli ordini a domicilio possono andare in consegna). Se due persone dello staff agiscono sullo stesso ordine nello stesso momento, la seconda riceve un messaggio chiaro per ricaricare invece di sovrascrivere la prima.",
        },
        {
          title: "I vincoli come ultima linea di difesa",
          body: "Tipo di ordine, metodo di pagamento e stato sono vincoli CHECK, i prezzi sono interi limitati espressi in centesimi, il magazzino non può andare sotto zero e le impostazioni di consegna hanno intervalli ammessi. Anche un bug in una funzione non può salvare un ordine impossibile.",
        },
        {
          title: "Row-level security su ogni tabella",
          body: "Tutte le 14 tabelle hanno RLS. Menu, zone e impostazioni sono leggibili da tutti; i clienti vedono solo i propri ordini e il proprio profilo (`customer_id = auth.uid()`); magazzino e movimenti sono solo per lo staff. L'appartenenza allo staff è una tabella separata, non un campo che un utente potrebbe modificare sul proprio profilo.",
        },
        {
          title: "Un assistente che può ripetere solo ciò che dice il database",
          body: "La funzione `assistente` ricostruisce il contesto dalle tabelle in tempo reale (con cache di 60 secondi): prodotti visibili con prezzi e allergeni, prodotti finiti oggi, aggiunte e zone di consegna attive, più gli ultimi tre ordini del cliente autenticato. Il prompt vieta di inventare prezzi o orari e invita sempre chi ha allergie a telefonare. Passa a un secondo modello se il primo fallisce e si ferma subito in caso di errori di autenticazione o di quota.",
        },
        {
          title: "Pagare l'AI senza subire abusi",
          body: "Ogni richiesta è limitata per chiamante (25 all'ora, identificato da un hash con sale dell'IP, così gli indirizzi non vengono salvati) e a livello globale (500 al giorno), con una tabella di contatori in Postgres così i limiti valgono tra istanze diverse della funzione. Le richieste arrivano solo dalle origini del sito, e la cronologia della conversazione è ridotta agli ultimi 8 messaggi con limiti di lunghezza.",
        },
      ],
      code: { caption: "Transizioni di stato consentite, da set_order_status in produzione (estratto)" },
      testing:
        "Il progetto non ha ancora una suite di test automatici. Per questa revisione ho controllato in sola lettura schema, policy RLS e definizioni delle funzioni in produzione, ed eseguito il security advisor di Supabase. Aggiungere test è la prima voce della roadmap qui sotto.",
      deployment:
        "La web app è un unico `index.html` caricato su Netlify, servito su buongustoaspio.it con una regola di redirect e tre regole di header. Le modifiche al database sono migrazioni Supabase (21 finora); le edge function sono pubblicate su Supabase con i segreti come variabili d'ambiente.",
      review: {
        public: [
          "La cronologia delle migrazioni contiene migrazioni iniziali ripetute, il che rende più difficile del dovuto ricostruire il database da zero.",
          "Qualche errore di testo sul sito: uno spazio mancante nel titolo principale, numeri dei passi duplicati nella guida all'ordine e la grafia del profilo Instagram.",
        ],
      },
      limitations: [
        "Nessun test automatico né CI; i rilasci sono caricamenti manuali.",
        "Nessun pagamento online: i clienti pagano alla cassa o al rider.",
        "La stampante per le comande è prevista ma non ancora collegata.",
      ],
      roadmap: [
        "Test sul database per `place_order` e `set_order_status` (pgTAP o un test runner Node su un Supabase locale).",
        "Una pipeline CI con scansione dei segreti e controlli automatici prima di ogni rilascio.",
        "Compattare la cronologia delle migrazioni in una base pulita.",
        "Integrazione della stampante di cucina per gli ordini accettati.",
      ],
      contribution:
        "Sviluppato da Ahmad: il footer del sito e le istruzioni dell'assistente lo indicano come sviluppatore, i deploy partono dal suo account Netlify e il suo CV riporta un precedente lavoro di gestione ordini per la stessa società.",
      ledger: [
        ["14 tabelle, 21 migrazioni, Postgres 17", L, "Catalogo Supabase, 13 ott 2026"],
        ["RLS attiva su tutte le tabelle; policy come descritte", L, "pg_policies"],
        [
          "25 funzioni nel database, tutte con search_path fissato; controlli dello staff con is_staff()",
          L,
          "Definizioni in pg_proc",
        ],
        [
          "Ricalcolo dei prezzi e controlli lato server in place_order; tabella delle transizioni e lock in set_order_status",
          L,
          "Corpo delle funzioni letto il 13 ott 2026",
        ],
        ["Contesto dell'assistente, modello di riserva, rate limit, origini consentite", L, "Edge function assistente"],
        ["Notifiche push ed email ai cambi di stato", L, "Edge function notify-order"],
        ["Pagine per i clienti, passi dell'ordine, metodi di pagamento", L, "buongustoaspio.it"],
        ["Framework del frontend", L, "Non determinabile senza il codice dell'app"],
      ],
    },
    slotbook: {
      title: "Slotbook",
      summary:
        "Prenotazione di appuntamenti per piccole attività di servizi: un'API REST su PostgreSQL con ruoli, sessioni a rotazione e un client web, dove la doppia prenotazione è impossibile anche con richieste simultanee.",
      status: "Progetto del portfolio",
      role: "Progettazione, sviluppo e test",
      problem:
        "Barbieri, fisioterapisti e insegnanti privati perdono tempo con le prenotazioni al telefono e i pomeriggi con due clienti alla stessa ora. Con Slotbook i clienti scelgono servizio, giorno e orario libero; lo staff vede la propria agenda; il titolare imposta servizi, staff e orari settimanali. Le parti difficili sono la correttezza con richieste simultanee, i fusi orari e la riservatezza dei dati di ciascuno.",
      users: [
        "Clienti che prenotano e disdicono appuntamenti dal telefono.",
        "Staff che consulta la giornata e segna gli appuntamenti come completati o mancati.",
        "Il titolare, che gestisce servizi, prezzi, staff e orari di lavoro.",
      ],
      features: [
        "Ruoli cliente, staff e titolare, verificati sul server a ogni richiesta.",
        "Token di accesso da 15 minuti più refresh token a rotazione in un cookie HttpOnly, con rilevamento del riuso.",
        "Disponibilità calcolata in SQL dagli orari di lavoro (con pause) meno le prenotazioni esistenti, nel fuso orario dell'attività.",
        "Prenotazione, disdetta con termine minimo per il cliente, completamento e registrazione delle assenze.",
        "Ricerca, filtri, ordinamento e paginazione sulle liste; modifica dell'account, cambio password e cancellazione.",
        "Descrizione OpenAPI 3.1 servita dall'API, più una pagina di documentazione leggibile.",
      ],
      screenshots: [
        {
          alt: "Prenotazione su telefono: elenco dei servizi, scelta della data e una griglia di orari liberi con le 10:30 selezionate.",
          caption: "Prenotazione su schermo da telefono. Gli orari arrivano dalla query di disponibilità.",
        },
        {
          alt: "Agenda del titolare: una tabella delle prossime prenotazioni con servizio, membro dello staff, cliente, stato e azioni.",
          caption: "Agenda del titolare con dati dimostrativi inventati.",
        },
      ],
      diagram: {
        title: "Percorso di una richiesta in Slotbook",
        caption:
          "Ogni richiesta passa da rate limit, verifica del token (con il ruolo riletto dal database), controllo dei ruoli e validazione rigorosa prima di arrivare al gestore.",
      },
      decisions: [
        {
          title: "È il database a rendere impossibile la doppia prenotazione",
          body: "La sovrapposizione è impedita da un vincolo di esclusione GiST su `(staff_id, tstzrange(starts_at, ends_at))` per le prenotazioni non annullate. I controlli applicativi danno messaggi chiari, ma solo il vincolo regge quando due richieste arrivano insieme. Un test invia tre richieste sovrapposte nello stesso istante e si aspetta esattamente un successo.",
        },
        {
          title: "Fusi orari gestiti dove stanno i dati",
          body: "Gli orari di lavoro sono orari di calendario. La disponibilità li converte con `(date + start_time) AT TIME ZONE tz` prima di generare gli slot, così anche nei giorni del cambio d'ora gli orari sono corretti. Creando una prenotazione il server ricontrolla orari, preavviso e orizzonte; la scelta del client non viene mai data per buona.",
        },
        {
          title: "Sessioni che resistono a un token rubato",
          body: "I refresh token sono casuali, salvati solo come hash e ruotati a ogni uso. Ogni login è una famiglia; riusare un token già ruotato revoca l'intera famiglia. Il ruolo dentro un access token non viene mai creduto: l'utente viene ricaricato a ogni richiesta, quindi una retrocessione o una cancellazione hanno effetto immediato.",
        },
        {
          title: "Nessuna dipendenza a runtime, per scelta",
          body: "Il server usa solo la libreria standard di Node più piccoli moduli nel repository: un validatore, JWT e un client del protocollo PostgreSQL con autenticazione SCRAM e pool di connessioni. Così la supply chain si riduce al runtime, in un ambiente senza registro dei pacchetti. Il costo è mantenere quel codice, quindi è testato direttamente, e il livello del database sta dietro `query()` e `tx()`: passare a `pg` richiede di cambiare un solo file.",
        },
      ],
      code: { caption: "L'invariante, da migrations/001_init.sql" },
      testing:
        "12 test unitari (validazione, hashing delle password, JWT falsificati e scaduti, rate limit, configurazione che si blocca in sicurezza, segreti da file, oscuramento dei log e un controllo che il documento OpenAPI corrisponda esattamente al router), 23 test di integrazione via HTTP su un database PostgreSQL 16 reale creato a ogni esecuzione e 2 test nel browser a larghezza da telefono. Due mutazioni volute, togliere il vincolo di sovrapposizione e rompere la separazione tra clienti, hanno fatto fallire la suite. Il test end-to-end ha trovato un bug vero: il refresh della sessione condivideva il rate limit del login, quindi ricaricando qualche volta si restava bloccati; ora il refresh ha un limite proprio.",
      deployment:
        "Gira come container in sola lettura e senza root. Un file Docker Compose locale avvia PostgreSQL e l'API su 127.0.0.1. Il deploy in produzione è descritto in Shipyard. Non pubblicato online.",
      limitations: [
        "I rate limit valgono per processo; con più repliche servirebbe un limitatore condiviso.",
        "Ancora niente email: nessuna verifica dell'indirizzo, reset della password o promemoria.",
        "Un'attività per database.",
      ],
      roadmap: [
        "Verifica email, reset della password e promemoria tramite una coda.",
        "Tempo di margine tra un appuntamento e l'altro.",
        "Feed iCal per ogni membro dello staff.",
      ],
      contribution: "Realizzato per questo portfolio. Codice, test e documentazione sono in `projects/slotbook`.",
      ledger: [
        ["Richieste simultanee per uno slot: ne riesce esattamente una", L, "Test di integrazione, PostgreSQL 16"],
        ["I clienti non possono leggere le prenotazioni altrui", L, "Test di integrazione; controllo per mutazione"],
        ["Il riuso di un refresh token revoca la famiglia di sessioni", L, "Test di integrazione"],
        ["Prenotare e disdire da telefono senza errori in console", L, "Test Playwright"],
        ["Lint, controllo dei tipi, formattazione", L, "ESLint, tsc --checkJs, Prettier"],
        ["Gira su AWS", L, "Non pubblicato"],
      ],
    },
    hostwatch: {
      title: "Hostwatch",
      summary:
        "Un monitor self-hosted per server Linux: un agente legge i numeri direttamente dal kernel, un server conserva lo storico e valuta le regole di allarme, e una dashboard si aggiorna in tempo reale con Server-Sent Events.",
      status: "Progetto del portfolio",
      role: "Progettazione, sviluppo e test",
      problem:
        "Un piccolo team con qualche server vuole sapere quando un disco si sta riempiendo, un servizio è caduto o un host ha smesso di rispondere, senza gestire uno stack completo Prometheus e Grafana. Hostwatch è la cosa più piccola che lo fa bene: metriche reali, storico, allarmi che non oscillano e una pagina sempre aggiornata.",
      users: ["Sviluppatori e amministratori di pochi server Linux o istanze VPS."],
      features: [
        "Agente senza dipendenze: CPU dalle differenze di `/proc/stat`, memoria da `MemAvailable`, carico, uptime, traffico di rete, spazio per ogni disco reale, stato delle unità systemd e, se si vuole, salute dei container Docker.",
        "Buffer offline: fino a 360 campioni restano in coda mentre il server è irraggiungibile e vengono consegnati in ordine.",
        "Modalità simulatore per le demo, con ogni campione simulato segnalato nei dati e sullo schermo.",
        "Regole di allarme con durata (CPU sopra il 90% per 5 minuti), regole immediate per dischi, host silenziosi, servizi falliti e container non sani; gli allarmi sopravvivono ai riavvii e si chiudono da soli.",
        "Dashboard live con riconnessione e ripiego automatico sul polling; da 1 a 48 ore di storico campionato per ogni host.",
      ],
      screenshots: [
        {
          alt: "Panoramica della dashboard: due allarmi critici sui servizi in alto, poi tre schede host: build-vm (reale, Critico) e db-1 e web-1 (segnati come Simulati, OK) con barre di CPU, memoria e disco.",
          caption:
            "Panoramica: build-vm è la macchina reale di sviluppo; db-1 e web-1 sono host simulati e segnalati come tali.",
        },
        {
          alt: "Dettaglio dell'host build-vm con grafici di CPU, memoria, disco e rete. Il grafico del disco scende da circa il 91% al 31%.",
          caption:
            "Il grafico del disco registra una correzione reale: un disco immagine in sola lettura al 91% veniva segnalato finché l'agente non ha imparato a ignorare i filesystem in sola lettura.",
        },
      ],
      diagram: {
        title: "Architettura di Hostwatch",
        caption:
          "Ogni token di un agente può inviare dati solo per il proprio host. Il server non ha mai bisogno di accedere agli host che sorveglia.",
      },
      decisions: [
        {
          title: "Leggere il kernel, non una libreria",
          body: "L'uso della CPU è la variazione dei jiffy occupati sulla variazione dei jiffy totali tra due letture di `/proc/stat`, escludendo il tempo guest già conteggiato. La memoria usa `MemAvailable` invece della memoria libera, che farebbe sembrare pieno ogni sistema Linux a causa della cache. I filesystem virtuali e in sola lettura vengono ignorati.",
        },
        {
          title: "Allarmi che non oscillano e non si ripetono",
          body: "Una regola a soglia scatta solo dopo che la condizione è durata per il tempo previsto, quindi un picco di 20 secondi resta silenzioso. Ogni coppia regola, host e soggetto è un solo allarme, quindi due servizi caduti sono due allarmi. Gli allarmi aperti vengono salvati, così un riavvio del server non li rinvia.",
        },
        {
          title: "Dati in tempo reale, con un piano di riserva",
          body: "La dashboard si iscrive con Server-Sent Events: una lunga risposta HTTP che i proxy capiscono, con commenti di heartbeat perché le connessioni inattive non vengano chiuse. Dopo tre riconnessioni fallite la pagina interroga il server ogni 10 secondi mentre continua a riprovare il flusso, e lo indica nell'intestazione.",
        },
        {
          title: "Privilegi minimi sugli host monitorati",
          body: "L'agente gira come unità systemd con un utente dinamico senza privilegi, filesystem in sola lettura, nessuna capability e un limite di memoria di 64 MB. Non ha mai bisogno del socket Docker; lo stato dei container dovrebbe passare da un proxy che consente un solo endpoint in lettura.",
        },
      ],
      testing:
        "11 test Python per l'agente (lettura di file `/proc` di prova, differenze di CPU, dischi in sola lettura, limiti del simulatore, consegna in ordine dei dati accumulati dopo un'interruzione) e 16 test Node per il server (durata e chiusura degli allarmi, comportamento ai riavvii, campionamento, validazione, autenticazione, legame dei token con gli host e flusso live). Un test esegue l'agente reale e passa il suo output al validatore del server, così i due non possono divergere. Il test di campionamento ha trovato un bug vero: SQLite divideva i timestamp come numeri decimali, quindi lo storico non veniva raggruppato affatto.",
      deployment:
        "Verificato dall'inizio alla fine su una VM Linux: un agente che legge la macchina reale e due agenti simulati, con allarmi che scattano e si chiudono e la dashboard aggiornata nel browser. Sono inclusi immagini Docker e un'unità systemd rafforzata. Non pubblicato online.",
      limitations: [
        "`node:sqlite` è ancora segnato come sperimentale in Node 22.",
        "Una sola password per la dashboard; nessun account utente.",
        "Solo CPU dell'intero host; ancora nessun consumo per container.",
      ],
      roadmap: [
        "CPU e memoria per container dai cgroup.",
        "Silenziamento degli allarmi durante la manutenzione.",
        "Un endpoint Prometheus per inviare i dati a uno stack esistente.",
      ],
      contribution: "Realizzato per questo portfolio. Codice, test e documentazione sono in `projects/hostwatch`.",
      ledger: [
        [
          "Metriche reali raccolte da una VM Linux e mostrate in tempo reale",
          L,
          "Eseguito sulla VM di sviluppo, 13 ott 2026",
        ],
        ["Gli allarmi scattano dopo la loro durata e si chiudono", L, "Test unitari; osservato nell'esecuzione reale"],
        [
          "Il flusso si riconnette; ripiego sul polling",
          L,
          "Codice; flusso coperto da test di integrazione, ripiego non testato nel browser",
        ],
        ["L'output dell'agente è accettato dal server", L, "Test di contratto tra linguaggi"],
        ["Gli host simulati sono segnalati", L, "Campo nei dati ed etichetta nell'interfaccia"],
      ],
    },
    prontix: {
      title: "Prontix",
      summary:
        "Sito e area clienti per un servizio di software, AI e automazioni per le piccole imprese italiane, con accesso, caricamento di documenti e domande a credito sui documenti del cliente.",
      status: "Sito online",
      role: "Sviluppatore: sito, area clienti, backend Supabase",
      problem:
        "Le piccole imprese delle Marche hanno spesso bisogno di un sito, di un sistema di prenotazione o di un assistente AI, ma non sanno valutare le offerte tecniche. Prontix presenta questi servizi in un italiano semplice, raccoglie richieste e prenotazioni di chiamate e offre ai clienti un'area dove provare l'AI sui propri documenti.",
      users: [
        "Titolari di negozi, ristoranti e studi professionali che cercano software o automazioni.",
        "Clienti che usano l'area riservata per caricare documenti e fare domande su di essi.",
      ],
      features: [
        "Pagine di servizi, settori e prezzi con un modulo per prenotare una chiamata e uno per richiedere un progetto.",
        "Accesso con Google o con email e password, e un'area clienti.",
        "Caricamento di documenti (testo, Markdown, CSV, JSON fino a 180 KB ciascuno) e risposte basate su quei documenti, un credito per domanda.",
        "Tema chiaro e scuro e una demo di assistente AI con dati inventati chiaramente segnalati.",
      ],
      diagram: {
        title: "Architettura di Prontix",
        caption:
          "Le domande sui documenti richiedono un utente autenticato e consumano un credito nel database prima che il modello venga chiamato.",
      },
      decisions: [
        {
          title: "I crediti si consumano nel database, prima di chiamare il modello",
          body: "In modalità `rag` la funzione ricava l'utente dal suo token e chiama una funzione `use_credit`. Solo se questa riesce viene chiamata OpenAI, così un cliente non può ottenere risposte oltre il proprio saldo riprovando.",
        },
        {
          title: "La scelta del modello è configurazione, non codice",
          body: "Il nome del modello viene letto da un documento di impostazioni dell'amministratore, con un valore predefinito da ambiente, quindi si può cambiare senza un nuovo deploy.",
        },
      ],
      review: {
        public: [
          "La pagina online mostra un conto alla rovescia senza numero e un calcolatore dei costi che restituisce zero; il link Admin è nel footer pubblico.",
        ],
      },
      testing:
        "Non sono stati trovati test automatici. La revisione si è limitata al sito online e al progetto Supabase (in sola lettura).",
      deployment:
        "Sito statico su Netlify; progetto Supabase `fixflow` con 4 tabelle e 6 edge function (AI, notifiche, traduzione, email di autenticazione).",
      limitations: [
        "Senza il codice del frontend non è stato possibile esaminare la struttura delle pagine e la logica lato client.",
      ],
      roadmap: [
        "Test automatici e una pipeline CI per il sito e le edge function.",
        "Correggere conto alla rovescia e calcolatore; togliere l'accesso amministratore dal footer pubblico.",
      ],
      contribution:
        "Ahmad ha realizzato il sito e il backend Supabase; entrambi sono nel suo team Netlify e nella sua organizzazione Supabase.",
      ledger: [
        ["Pagine, moduli, metodi di accesso, limiti di caricamento", L, "prontix-a.netlify.app"],
        ["Modalità RAG a credito, modello dalle impostazioni", L, "Edge function ai"],
        ["Tabelle ed edge function", L, "Progetto Supabase fixflow"],
        [
          "Collegamento tra Prontix e il progetto fixflow",
          L,
          "Funzionalità corrispondenti; nessuna configurazione di deploy li collega",
        ],
      ],
    },
    shipyard: {
      title: "Shipyard",
      summary:
        "Il percorso verso la produzione per Slotbook e Hostwatch su un solo host AWS EC2: Docker Compose dietro Caddy con HTTPS automatico, backup verificati, deploy con health check e rollback automatico, e una pipeline CI/CD con scansioni e approvazione manuale.",
      status: "Progetto del portfolio",
      role: "Progettazione, script, pipeline e documentazione",
      problem:
        "Due applicazioni funzionanti sono solo metà del lavoro. Servono TLS, segreti fuori dai file di ambiente, backup che qualcuno ha davvero ripristinato, un deploy che non può lasciare il sito aggiornato a metà e una pipeline che ferma un'immagine vulnerabile prima che vada online. Shipyard è questo livello, dimensionato per un solo server.",
      users: ["Chi è di turno per un piccolo prodotto che gira su un solo server."],
      features: [
        "File Compose di produzione: solo Caddy espone porte; PostgreSQL sta su una rete interna senza uscita verso internet; container in sola lettura con tutte le capability rimosse, limiti di memoria, health check e rotazione dei log.",
        "Segreti come file con permessi 600, montati come secret Docker; entrambe le applicazioni leggono variabili `NAME_FILE`.",
        "`deploy.sh`: backup verificato, pull, migrazione, avvio, health check, rollback automatico se la nuova versione non è sana entro 90 secondi.",
        "`backup.sh` e `restore.sh`: archivi `pg_dump` verificati con checksum e conservazione limitata; il ripristino passa da un database temporaneo e conserva quello sostituito.",
        "Preparazione dell'host Ubuntu 24.04: Docker dal repository firmato, solo chiavi SSH, firewall, aggiornamenti di sicurezza automatici.",
        "CI: test, ShellCheck, actionlint, gitleaks, scansioni Trivy di immagini e Dockerfile. Release: immagini con SBOM e provenienza della build. Deploy: attende l'approvazione di un revisore.",
      ],
      diagram: {
        title: "Deploy con Shipyard",
        caption: "Tutto ciò che sta a destra gira su una sola istanza EC2. Solo Caddy è raggiungibile da internet.",
      },
      decisions: [
        {
          title: "Un rollback sicuro grazie a migrazioni disciplinate",
          body: "Il rollback riavvia solo l'immagine precedente; il database non viene toccato. È sicuro perché le migrazioni seguono il modello expand/contract: una versione aggiunge prima di togliere, e toglie solo ciò che la versione precedente non legge più. Il rollback dei dati resta un ripristino separato e voluto, che rifiuta di partire senza `--confirm`.",
        },
        {
          title: "Un backup non è un backup finché non viene riletto",
          body: "Ogni dump viene elencato con `pg_restore --list` prima di essere conservato, e ne viene calcolato il checksum. I ripristini non scrivono mai direttamente sul database in uso: riempiono un database temporaneo, scambiano i nomi e conservano quello vecchio.",
        },
        {
          title: "Testare gli script, non solo le applicazioni",
          body: "Di solito gli script di deploy non vengono testati fino alla notte in cui servono. Qui un finto `docker` permette a 19 test di far fallire pull, migrazione, backup o health check, e di verificare che la versione in esecuzione non resti mai rotta.",
        },
        {
          title: "Niente Terraform finché non si può pianificare",
          body: "L'infrastruttura è un'istanza, un security group e un Elastic IP, documentati passo per passo. Terraform è il prossimo passo, ma scriverlo senza eseguire `plan` su un account reale vorrebbe dire dichiarare più di quanto il progetto possa dimostrare.",
        },
      ],
      testing:
        "19 test degli script con una finta CLI di Docker (ordine del deploy, rollback automatico, errore a ogni passo, validazione dei tag, protezioni del ripristino, lock). Il file Compose di produzione viene risolto con `docker compose config`, e il modello risultante è stato verificato: solo Caddy espone porte, PostgreSQL è solo interno, entrambi i container applicativi sono in sola lettura. Tutti i file YAML dei workflow sono validi.",
      deployment:
        "Non pubblicato: non sono state create risorse AWS e durante lo sviluppo non era disponibile un demone Docker. ShellCheck, actionlint, la validazione del Caddyfile e i workflow stessi girano in CI, non nell'ambiente di sviluppo. Il README elenca con precisione cosa è stato verificato e cosa no.",
      limitations: [
        "Un solo host, nessuna alta disponibilità.",
        "Backup logici giornalieri: fino a 24 ore di dati a rischio.",
        "I log restano sull'host.",
      ],
      roadmap: [
        "Terraform con `plan` in CI.",
        "Archiviazione WAL per il ripristino a un momento preciso.",
        "Log su CloudWatch con allarmi sul tasso di errori.",
        "Deploy blue/green dietro Caddy.",
      ],
      contribution: "Realizzato per questo portfolio. Tutti i file sono in `projects/shipyard` e `.github/workflows`.",
      ledger: [
        ["Logica di deploy, rollback, backup e ripristino", L, "19 test con una finta CLI di Docker"],
        ["Esposizione di rete: solo Caddy espone porte", L, "docker compose config risolto"],
        ["I workflow girano su GitHub Actions", L, "Non eseguiti: repository non pubblicato"],
        ["Gira su EC2 con certificati reali", L, "Non pubblicato"],
      ],
    },
    stepvia: {
      title: "Stepvia International Education",
      summary:
        "Un sito multilingua per un'agenzia che aiuta studenti libanesi a iscriversi alle università italiane, dalla scelta del corso all'arrivo con il visto.",
      status: "Sito online",
      role: "Sviluppatore del sito e dell'assistente",
      problem:
        "Le famiglie libanesi che pensano allo studio in Italia affrontano un percorso sconosciuto: scelta dell'università, candidature, legalizzazione dei documenti, visto di studio e permesso di soggiorno. L'agenzia aveva bisogno di un unico posto che spiegasse i passaggi, mostrasse i pacchetti e raccogliesse le richieste nelle lingue dei suoi clienti.",
      users: ["Futuri studenti e le loro famiglie in Libano e nei paesi vicini."],
      features: [
        "Versioni in inglese, francese e arabo.",
        "Le sei fasi del percorso, dalla scoperta all'arrivo.",
        "Ricerca delle università per città e lingua di insegnamento.",
        "Tre pacchetti di servizi con ciò che includono ed escludono.",
        "Un modulo di orientamento gratuito con un campo nascosto anti-spam, contatto WhatsApp e un accesso separato per gli studenti.",
        "Un assistente AI («Ask Stepvia») per le domande sullo studio in Italia, con passaggio al team.",
      ],
      testing: "Il codice sorgente non era disponibile; i contenuti sono stati verificati sul sito online.",
      deployment: "Ospitato su Netlify.",
      review: {
        public: [
          "I tempi del permesso di soggiorno compaiono sia come 8 giorni sia come 8 giorni lavorativi, e la pagina dichiara la variante britannica dell'inglese.",
        ],
      },
      limitations: ["Backend, archiviazione dei dati e funzionamento dell'assistente non sono verificabili."],
      roadmap: ["Condividere il repository per poter esaminare e documentare l'app per gli studenti e l'assistente."],
      contribution: "Il footer indica Ahmad Kassar come autore del sito.",
      ledger: [
        ["Lingue, percorso, ricerca, pacchetti, modulo, accesso, pannello assistente", L, "step-via.netlify.app"],
        ["Funzionamento del backend e dell'assistente", L, "Codice non disponibile"],
      ],
    },
  },
};
