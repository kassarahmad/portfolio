// Case studies for work that existed before this repository.
// Evidence levels: "source" (code reviewed), "database" (schema, policies or
// function definitions inspected read-only), "live" (observed on the public
// site), "cv" (stated on the CV only). See docs/AUDIT.md for method and dates.

export const buongusto = {
  slug: "buongusto-aspio",
  title: "Pizzeria Buon Gusto",
  summary:
    "Online ordering, staff back-office and an AI assistant for a wood-fired pizzeria in Aspio, Ancona, running on its own domain.",
  status: "Live in production",
  categories: ["full-stack", "backend", "frontend", "ai"],
  period: "2026",
  role: "Developer: database, edge functions, web app, deployment",
  stack: [
    "Supabase Postgres 17",
    "PL/pgSQL",
    "Row-level security",
    "Deno edge functions",
    "TypeScript",
    "OpenAI API",
    "Web Push (VAPID)",
    "Brevo email",
    "Netlify",
  ],
  links: [{ label: "Live site", url: "https://buongustoaspio.it/" }],
  featured: true,
  problem:
    "The pizzeria took orders by phone and WhatsApp during a short, busy evening window. They wanted customers to order pickup, table or delivery from their phones, see whether the order was accepted, and get answers about the menu without calling, while staff kept a separate place to run orders, menu, stock and delivery.",
  users: [
    "Customers in the Ancona area ordering for pickup, at the table or for delivery.",
    "Pizzeria staff accepting or rejecting orders, assigning riders and managing stock from a management area that customers never see.",
  ],
  features: [
    "Account sign-up with email code or Google; profile, saved address and account deletion handled by the customer.",
    "Ordering for pickup, table or delivery in 15-minute slots, with delivery zones by postcode, minimum order, delivery fee and per-slot capacity.",
    "An order status flow that customers follow live: received, accepted, ready, out for delivery, completed, or rejected with a reason.",
    "Push notifications and branded emails at every status change; push alerts to staff for new orders and support requests.",
    "Products marked out of stock automatically when an ingredient they use runs out, or switched off for a single day.",
    "An assistant that answers questions about the menu, allergens, delivery and the customer's own recent orders, and a button to talk to a person.",
  ],
  diagram: {
    id: "bg",
    width: 780,
    height: 330,
    title: "Buon Gusto architecture: browser app, Supabase services, external providers",
    nodes: [
      { id: "web", x: 20, y: 40, w: 170, h: 56, label: "Web app", sub: "Netlify · customer + staff" },
      { id: "auth", x: 300, y: 10, w: 170, h: 48, label: "Supabase Auth", sub: "email code, Google" },
      {
        id: "db",
        x: 300,
        y: 110,
        w: 170,
        h: 70,
        label: "Postgres 17",
        sub: "14 tables · RLS · 25 functions",
        kind: "store",
      },
      { id: "assist", x: 300, y: 240, w: 170, h: 52, label: "assistente", sub: "edge function" },
      { id: "notify", x: 580, y: 110, w: 170, h: 70, label: "notify-order", sub: "edge function" },
      { id: "openai", x: 580, y: 240, w: 170, h: 52, label: "OpenAI", sub: "chat completions", kind: "ext" },
      { id: "push", x: 580, y: 10, w: 170, h: 48, label: "Web Push · Brevo", sub: "phones and inboxes", kind: "ext" },
    ],
    edges: [
      { from: "web", to: "auth", sides: ["right", "left"] },
      { from: "web", to: "db", sides: ["right", "left"], label: "RPC + reads", labelAt: [245, 138] },
      { from: "web", to: "assist", sides: ["bottom", "left"], label: "questions", labelAt: [150, 260] },
      { from: "assist", to: "db", sides: ["top", "bottom"] },
      { from: "assist", to: "openai", sides: ["right", "left"] },
      { from: "db", to: "notify", sides: ["right", "left"], label: "webhook on change", labelAt: [525, 138] },
      { from: "notify", to: "push", sides: ["top", "bottom"] },
    ],
    caption:
      "Customers and staff use the same web app; every write goes through a database function, and order changes fan out to notifications from a database webhook.",
  },
  decisions: [
    {
      title: "Business rules live in the database, not the browser",
      body: "Customers have no insert or update rights on orders. They call `place_order`, a `SECURITY DEFINER` function with a pinned `search_path`, which ignores any price sent by the browser and recomputes every line from the menu and extras, then checks opening hours, the delivery zone by postcode, lead time, slot capacity, minimum order and whether any ingredient is out of stock. A tampered browser can't change a price or order something that's sold out.",
    },
    {
      title: "Order status is a state machine with a row lock",
      body: "`set_order_status` checks `is_staff()`, locks the order row with `SELECT … FOR UPDATE`, and only allows the transitions listed in the function (for example, only delivery orders can go out for delivery). If two staff members act on the same order at once, the second gets a clear message to reload instead of overwriting the first.",
    },
    {
      title: "Constraints as the last line of defence",
      body: "Order type, payment method and status are CHECK constraints, prices are bounded integers in cents, stock can't go negative, and delivery settings have ranges. Even a bug in a function can't store an impossible order.",
    },
    {
      title: "Row-level security on every table",
      body: "All 14 tables have RLS. Menu, zones and settings are public to read; customers see only their own orders and profile (`customer_id = auth.uid()`); stock and stock movements are staff-only. Staff membership is a separate table rather than a flag a user could edit on their own profile.",
    },
    {
      title: "An assistant that can only repeat what the database says",
      body: "The `assistente` function rebuilds its context from live tables (cached for 60 seconds): visible products with prices and allergens, items sold out today, extras and active delivery zones, plus the signed-in customer's last three orders. The prompt forbids inventing prices or times and always tells customers with allergies to call. It falls back to a second model if the first fails and stops early on authentication or quota errors.",
    },
    {
      title: "Paying for AI without being abused",
      body: "Each request is limited per caller (25 per hour, keyed by a salted hash of the IP so raw addresses aren't stored) and globally (500 per day), using a counter table in Postgres so limits hold across function instances. Requests only come from the site's own origins, and conversation history is trimmed to the last 8 messages with length caps.",
    },
  ],
  code: {
    caption: "Allowed status transitions, from set_order_status as deployed (excerpt)",
    lang: "sql",
    text: `if not public.is_staff() then
  raise exception 'Solo lo staff può cambiare lo stato degli ordini';
end if;
select * into v_o from public.orders where id = p_id for update;

if not (
  (v_o.status = 'NEW'      and p_status in ('ACCEPTED','REJECTED')) or
  (v_o.status = 'ACCEPTED' and p_status in ('READY','REJECTED')) or
  (v_o.status = 'ACCEPTED' and v_o.type = 'DELIVERY' and p_status = 'OUT_FOR_DELIVERY') or
  (v_o.status = 'READY'    and v_o.type = 'DELIVERY' and p_status = 'OUT_FOR_DELIVERY') or
  (v_o.status = 'READY'    and v_o.type <> 'DELIVERY' and p_status = 'COMPLETED') or
  (v_o.status = 'OUT_FOR_DELIVERY' and p_status = 'COMPLETED')
) then
  raise exception 'Questo ordine è già stato aggiornato: ricarica la pagina';
end if;`,
  },
  testing:
    "The project has no automated test suite yet. During this review I checked the live schema, RLS policies and function definitions read-only, and ran Supabase's security advisor. Adding tests is the first roadmap item below.",
  deployment:
    "The web app is a single `index.html` deployed to Netlify by upload, served on buongustoaspio.it with one redirect rule and three header rules. Database changes are Supabase migrations (21 so far); edge functions are deployed to Supabase with secrets held as environment variables.",
  review: {
    privateCount: 5,
    public: [
      "The migration history contains repeated early migrations, which makes rebuilding the database from scratch harder than it should be.",
      "A few copy issues on the live site: a missing space in the hero line, duplicated step numbers in the ordering guide, and the Instagram handle spelling.",
    ],
  },
  limitations: [
    "No automated tests or CI; releases are manual uploads.",
    "No online payment: customers pay at the counter or to the rider.",
    "The kitchen ticket printer is planned but not connected yet.",
  ],
  roadmap: [
    "Database tests for `place_order` and `set_order_status` (pgTAP or a Node test runner against a local Supabase).",
    "A CI pipeline with secret scanning and automatic checks before each release.",
    "Squash the migration history into a clean baseline.",
    "Kitchen printer integration for accepted orders.",
  ],
  contribution:
    "Developed by Ahmad: the site footer and the assistant's own instructions credit him as developer, deployments come from his Netlify account, and his CV lists earlier order-management work for the same operating company.",
  ledger: [
    ["14 tables, 21 migrations, Postgres 17", "database", "Supabase catalog, 13 Oct 2026"],
    ["RLS enabled on all tables; policy rules as described", "database", "pg_policies"],
    [
      "25 database functions, all with a pinned search_path; staff checks via is_staff()",
      "database",
      "pg_proc definitions",
    ],
    [
      "Server-side re-pricing and checks in place_order; transition table and row lock in set_order_status",
      "database",
      "Function bodies read, 13 Oct 2026",
    ],
    ["Assistant grounding, model fallback, rate limits, CORS allow-list", "source", "assistente edge function"],
    ["Push and email notifications on order changes", "source", "notify-order edge function"],
    ["Customer-facing pages, ordering steps, payment options", "live", "buongustoaspio.it"],
    ["Frontend framework", "unknown", "Not determinable without the app source"],
  ],
};

export const prontix = {
  slug: "prontix",
  title: "Prontix",
  summary:
    "Website and client area for a software, AI and automation service for small Italian businesses, with sign-in, document upload and credit-metered questions over a client's own documents.",
  status: "Live site",
  categories: ["full-stack", "frontend", "ai"],
  period: "2026",
  role: "Developer: site, client area, Supabase backend",
  stack: ["Supabase (Auth, Postgres, Edge Functions)", "TypeScript", "OpenAI API", "Brevo", "Netlify"],
  links: [{ label: "Live site", url: "https://prontix-a.netlify.app/" }],
  featured: true,
  problem:
    "Small businesses in the Marche region often need a website, a booking flow or an AI assistant but can't evaluate technical offers. Prontix presents those services in plain Italian, takes requests and call bookings, and gives clients an area where they can try AI on their own documents.",
  users: [
    "Owners of shops, restaurants and professional practices looking for software or automation.",
    "Existing clients using the client area to upload documents and ask questions about them.",
  ],
  features: [
    "Service, sector and pricing pages with a call-booking form and a project request form.",
    "Sign-in with Google or email and password, and a client area.",
    "Document upload (text, Markdown, CSV, JSON up to 180 KB each) and questions answered from those documents, one credit per question.",
    "Light and dark themes and a demo of an AI assistant using clearly labelled invented data.",
  ],
  diagram: {
    id: "px",
    width: 780,
    height: 250,
    title: "Prontix architecture",
    nodes: [
      { id: "web", x: 20, y: 90, w: 170, h: 56, label: "Site + client area", sub: "Netlify" },
      { id: "auth", x: 300, y: 10, w: 170, h: 48, label: "Supabase Auth", sub: "Google, email" },
      { id: "ai", x: 300, y: 95, w: 170, h: 48, label: "ai function", sub: "chat · json · rag" },
      { id: "db", x: 300, y: 180, w: 170, h: 56, label: "Postgres", sub: "documents, chunks, credits", kind: "store" },
      { id: "openai", x: 580, y: 95, w: 170, h: 48, label: "OpenAI", kind: "ext" },
    ],
    edges: [
      { from: "web", to: "auth", sides: ["right", "left"] },
      { from: "web", to: "ai", sides: ["right", "left"] },
      { from: "web", to: "db", sides: ["right", "left"] },
      { from: "ai", to: "db", sides: ["bottom", "top"], label: "spend credit", labelAt: [420, 166] },
      { from: "ai", to: "openai", sides: ["right", "left"] },
    ],
    caption:
      "Questions over documents require a signed-in user and spend one credit in the database before the model is called.",
  },
  decisions: [
    {
      title: "Credits are spent in the database, before the model call",
      body: "In `rag` mode the function resolves the user from their token and calls a `use_credit` function. Only if that succeeds does it call OpenAI, so a client can't get answers past their balance by retrying.",
    },
    {
      title: "Model choice is configuration, not code",
      body: "The model name is read from an admin settings document, with an environment default, so it can be changed without redeploying.",
    },
  ],
  review: {
    privateCount: 1,
    public: [
      "The live page shows an empty countdown number and a cost calculator rendering zeros; the Admin link sits in the public footer.",
    ],
  },
  testing: "No automated tests were found. Review was limited to the live site and the Supabase project (read-only).",
  deployment:
    "Static site on Netlify; Supabase project `fixflow` with 4 tables and 6 edge functions (AI, notifications, translation, auth emails).",
  limitations: ["Without the frontend source, page structure and client-side logic could not be reviewed."],
  roadmap: [
    "Automated tests and a CI pipeline for the site and the edge functions.",
    "Fix the countdown and calculator; move admin access off the public footer.",
  ],
  contribution:
    "Ahmad built the site and the Supabase backend; both are in his Netlify team and Supabase organisation.",
  ledger: [
    ["Pages, forms, sign-in methods, upload limits", "live", "prontix-a.netlify.app"],
    ["Credit-metered RAG mode, model from settings", "source", "ai edge function"],
    ["Tables and edge functions", "database", "Supabase project fixflow"],
    ["Link between Prontix and the fixflow project", "partial", "Matching features; no deploy config links them"],
  ],
};

export const stepvia = {
  slug: "stepvia",
  title: "Stepvia International Education",
  summary:
    "A multilingual site for an agency that helps students from Lebanon apply to Italian universities, from choosing a course to arriving with a visa.",
  status: "Live site",
  categories: ["frontend"],
  period: "2026",
  role: "Developer of the website and assistant",
  stack: ["HTML, CSS, JavaScript", "Netlify"],
  links: [{ label: "Live site", url: "https://step-via.netlify.app/" }],
  featured: false,
  problem:
    "Families in Lebanon considering study in Italy face an unfamiliar process: university choice, applications, document legalisation, the study visa and the stay permit. The agency needed one place that explains the steps, shows its packages and collects enquiries in the languages its clients speak.",
  users: ["Prospective students and their families in Lebanon and nearby countries."],
  features: [
    "English, French and Arabic versions.",
    "The six stages of the process, from discovery to arrival.",
    "University search filtered by city and teaching language.",
    "Three service packages with what each includes and excludes.",
    "A free-guidance form with a hidden spam trap field, WhatsApp contact and a separate student sign-in.",
    'An "Ask Stepvia" AI assistant panel for questions about studying in Italy, with a hand-off to the team.',
  ],
  testing: "No source code was available for review; content was checked on the live site.",
  deployment: "Hosted on Netlify.",
  review: {
    privateCount: 0,
    public: [
      "The stay-permit timing appears as both 8 days and 8 working days, and the page declares a British English locale.",
    ],
  },
  limitations: ["Backend, data storage and the assistant's implementation could not be verified."],
  roadmap: ["Share the repository so the student app and assistant can be reviewed and documented."],
  contribution: "The footer credits Ahmad Kassar as the site's author.",
  ledger: [
    ["Languages, process, search, packages, form, sign-in link, assistant panel", "live", "step-via.netlify.app"],
    ["Backend and assistant implementation", "unknown", "Source not available"],
  ],
};

export const hyperlean = {
  slug: "hyperlean-rag-assistant",
  title: "RAG assistant for industrial cost estimation",
  summary:
    "A virtual assistant built at Hyperlean that answers questions about an industrial cost-estimation and quoting application using only its own documentation, deployed on AWS with cost and abuse controls. Also my BSc thesis.",
  status: "Delivered at Hyperlean",
  categories: ["ai", "backend", "cloud"],
  period: "2025–2026",
  role: "Developer: RAG backend, ingestion pipeline, desktop integration, AWS deployment, evaluation",
  stack: ["Python", "FastAPI", "OpenAI API", "Qdrant", "Redis", "Docker", "AWS EC2", "VB.NET", "Swagger UI"],
  links: [],
  featured: true,
  org: "Hyperlean S.r.l.",
  problem:
    "Engineers estimating production costs work inside a technical desktop application full of parameters, validity rules and configuration steps. The knowledge they need exists, but it is spread across PDF manuals, Excel parameter tables and operating notes, so every doubt means leaving the task to search. A generic chatbot would answer fluently but without any link to the company's documentation, and in cost estimation an invented parameter can change a quote. The goal was an assistant inside the application that answers from the documentation and says clearly when the answer isn't there.",
  users: [
    "Users of the cost-estimation and quoting application who need procedures, definitions and configuration steps while they work.",
    "Administrators who maintain the knowledge base and the technical glossary.",
  ],
  features: [
    "Questions asked from inside the existing VB.NET desktop application, with the last few turns kept as conversation context.",
    "Answers grounded in retrieved passages of the documentation (Retrieval-Augmented Generation), with numbered steps for procedures.",
    'An explicit "not in the documentation" answer for questions outside the knowledge base instead of a guess.',
    "Ingestion of PDF, Excel and text documents through one pipeline: extraction, cleaning, chunking, embedding, storage in Qdrant.",
    "Answers in the language of the question; a controlled technical glossary keeps domain terms consistent across languages.",
    "Separate query and admin roles, separate production and development knowledge bases, and a health endpoint that checks every dependency.",
  ],
  diagram: {
    id: "hl",
    width: 780,
    height: 300,
    title: "Architecture of the RAG assistant",
    nodes: [
      { id: "client", x: 20, y: 110, w: 150, h: 60, label: "Desktop client", sub: "VB.NET, no keys" },
      { id: "api", x: 240, y: 95, w: 180, h: 90, label: "FastAPI on EC2", sub: "auth · retrieval · prompt" },
      { id: "redis", x: 240, y: 225, w: 180, h: 50, label: "Redis", sub: "rate limit · token quota", kind: "store" },
      { id: "qd", x: 500, y: 20, w: 150, h: 60, label: "Qdrant (Docker)", sub: "docs · dev · glossary", kind: "store" },
      { id: "oa", x: 500, y: 130, w: 150, h: 50, label: "OpenAI", sub: "embeddings · answers", kind: "ext" },
      { id: "admin", x: 500, y: 225, w: 150, h: 50, label: "Admin", sub: "/rag/ingest, Swagger" },
    ],
    edges: [
      { from: "client", to: "api", sides: ["right", "left"], label: "/rag/ask", labelAt: [205, 132] },
      { from: "api", to: "redis", sides: ["bottom", "top"] },
      { from: "api", to: "qd", sides: ["right", "left"], label: "top-k search", labelAt: [460, 40] },
      { from: "api", to: "oa", sides: ["right", "left"] },
      { from: "admin", to: "api", sides: ["left", "right"], labelAt: [460, 240] },
    ],
    caption:
      "The desktop client only talks to the backend. Keys, retrieval, prompts and limits all live on the server, so the assistant can change without shipping a new client.",
  },
  decisions: [
    {
      title: "The client never touches the model or the database",
      body: "Early prototypes called the model API directly from the desktop client. The final design moved everything behind FastAPI: the client sends a question with an API key and gets an answer. Keys for OpenAI and Qdrant stay on the server, and changes to chunking, prompts or retrieval reach every user without a new desktop release.",
    },
    {
      title: "Data quality first",
      body: "Raw PDF extraction produced broken words, repeated headers and random spacing; raw Excel extraction produced rows of empty `| | |` cells. Both polluted the embeddings. A page-by-page PDF extractor with normalisation and an Excel extractor that rewrites rows as `field: value` sentences made retrieval noticeably more relevant. The thesis's main lesson is that answer quality is decided at ingestion, before the model is involved.",
    },
    {
      title: 'Saying "I don\'t know" is a feature',
      body: "The system prompt allows answers only from retrieved context and tells the model to state when the documentation doesn't cover a question. In evaluation, a question about licence prices, which the documentation doesn't contain, was answered with an explicit statement of the gap rather than a plausible number.",
    },
    {
      title: "Costs controlled in the backend, not by hope",
      body: "A low-cost model handles ordinary questions, with a stronger one as fallback. Output is capped (300 to 600 tokens, mapped from a verbosity setting). Redis enforces 20 questions per user every two hours and a daily token quota per user; administrators' ingestion bypasses these limits. Budget and model allow-lists at the provider are a backstop, not the only control.",
    },
    {
      title: "Terminology fixed after generation, not by prompt",
      body: "Multilingual tests showed correct languages but unstable technical terms, half English, half translated. Rather than pushing the prompt harder, a separate glossary collection in Qdrant holds approved term pairs per language and customer; after generation, matching terms are replaced deterministically. Record IDs are derived from customer, language and term, so re-uploading a CSV updates entries instead of duplicating them.",
    },
    {
      title: "Defence in layers on AWS",
      body: "Qdrant runs self-hosted in Docker on EC2 after a prototype on Qdrant Cloud. Access is limited three times: the security group (SSH from one address, Qdrant only from authorised addresses), a mandatory Qdrant API key, and a deny-by-default UFW firewall on the host, with regular updates and volume snapshots for recovery.",
    },
  ],
  code: {
    caption: "Per-user rate limit with Redis (logic from the thesis, Python)",
    lang: "python",
    text: `limit = 20
window_seconds = 7200
key = f"rl:{BOOT_ID}:{user_id}:{int(time.time() // window_seconds)}"
count = redis.incr(key)
if count == 1:
    redis.expire(key, window_seconds)
if count > limit:
    return 429, {"Retry-After": redis.ttl(key)}`,
  },
  testing:
    "Evaluated with guided conversations covering the real uses of the application: a step-by-step procedure, a domain definition, configuring an analysis strategy, a three-point summary, an out-of-scope question, and questions in English and French. Each answer was judged on relevance, clarity, actionability, completeness, behaviour without information, and language consistency. The out-of-scope question was handled without inventing; the language tests revealed the terminology problem that led to the glossary. The thesis is explicit that this is a qualitative evaluation on a focused set of cases, not a large-scale measurement.",
  deployment:
    "FastAPI backend and self-hosted Qdrant in Docker on AWS EC2; Redis for counters; configuration and secrets from environment variables; separate production and development collections so new documents can be tested without affecting users; `/health` checks the API, OpenAI, Qdrant and the configured collection. Storage growth is estimated from the number of stored vectors (1,536 dimensions × 4 bytes × an overhead factor) and reported after every ingestion test.",
  limitations: [
    "Answer quality depends on retrieval: if the right passage isn't retrieved, a strong model can't fix it.",
    "Chunk size, overlap and cleaning rules need tuning for each kind of document.",
    "The evaluation is qualitative and limited to representative cases; there are no automated quality metrics yet.",
    "Source code and screenshots belong to the company and aren't shown here.",
  ],
  roadmap: [
    "Automated quality metrics and a fixed regression set of questions.",
    "Caching of frequent questions and embeddings; multi-tenant collections.",
    "A beta with a wider group of users to collect real, ambiguous questions.",
    "Retrieval restricted to documents in the question's language.",
  ],
  contribution:
    'Built during my work at Hyperlean S.r.l. (October 2025 to March 2026) and presented as my BSc thesis in Computer Science at the University of Camerino: "Design and experimental evaluation of a RAG virtual assistant supporting an industrial quoting tool" (supervisor Prof. Lorenzo Rossi, co-supervisor Prof. Irene Cappelli). The application it supports isn\'t named, as in the thesis.',
  ledger: [
    ["Architecture: VB.NET client, FastAPI, Qdrant on EC2, OpenAI", "thesis", "Thesis chapter 4"],
    ["PDF and Excel extraction fixes and their effect on retrieval", "thesis", "Thesis 4.2, figures 4.2 to 4.4"],
    ["Redis rate limit, daily token quota, output caps, model fallback", "thesis", "Thesis 4.7"],
    ["Glossary as deterministic post-processing with idempotent IDs", "thesis", "Thesis 5.2.7"],
    ["Out-of-scope question answered without inventing", "thesis", "Thesis experiment 5"],
    ["Built at Hyperlean S.r.l.", "cv", "CV; stated by Ahmad"],
    ["Source code", "unknown", "Company property, not available"],
  ],
};
