// Every fact here comes from the CV (2026), the BSc thesis (2026) or from
// systems inspected during the audit (docs/AUDIT.md). Don't add claims without a source.
// This is the English base; translations live in src/i18n/<lang>.mjs.

export const profile = {
  name: "Ahmad Kassar",
  headline: "Ahmad Kassar",
  role: "Software engineer: full-stack development, AI integration, Linux and cloud infrastructure",
  availability: "Open to junior roles in Italy or remote",
  location: "Ancona, Italy",
  email: "kassarahmad313@gmail.com",
  phone: "+39 351 690 5901",
  github: "https://github.com/kassarahmad",
  lede:
    "I build software that companies run every day: a RAG assistant that answers engineers from their own technical documentation at Hyperlean, " +
    "an ordering platform with its own database rules and AI assistant for a pizzeria in Ancona, and services I deploy myself with Docker on Linux and AWS. " +
    "BSc in Computer Science from the University of Camerino; now in the MSc programme.",
  about: [
    "I like the part of software that starts after the demo works: making answers trustworthy, keeping costs predictable, deciding what happens when a dependency fails, and being able to deploy again tomorrow. At Hyperlean that meant cleaning PDF and Excel documentation before it reached the model, putting per-user limits on a paid API and teaching the assistant to say when it doesn't know. For a restaurant it meant enforcing prices and order states in the database so a tampered browser can't change them.",
    "Most of my work has been for small and mid-sized businesses: an industrial software company, a restaurant taking orders every evening, an agency answering families in three languages, a services brand selling AI tools. I'm looking for a junior role in full-stack, backend, AI or platform engineering where I can keep learning from people who run larger systems than I have.",
  ],
  languages: [
    ["Arabic", "native"],
    ["Italian", "C1, professional"],
    ["English", "B2, professional"],
    ["French", "B1, working knowledge"],
  ],
};

// level: "work" = used in delivered work for a client or employer
//        "project" = demonstrated in a portfolio project in this repository
//        "cv" = listed on the CV, no code reviewed here
export const skillGroups = [
  {
    title: "Languages",
    items: [
      ["Python", "work", "Hyperlean RAG backend (FastAPI); Hostwatch agent"],
      ["TypeScript / JavaScript", "work", "Buon Gusto and Prontix edge functions; Slotbook, Hostwatch"],
      ["SQL and PL/pgSQL", "work", "Buon Gusto: 25 database functions, constraints and access policies"],
      ["VB.NET", "work", "Hyperlean desktop client integration"],
      ["Java, C++", "cv", "University coursework and online courses"],
    ],
  },
  {
    title: "AI and data",
    items: [
      ["Retrieval-augmented generation", "work", "Hyperlean assistant; Buon Gusto menu and order grounding"],
      ["OpenAI API, embeddings", "work", "Hyperlean, Buon Gusto, Prontix; model fallback"],
      ["Qdrant vector database", "work", "Hyperlean: documents, dev and glossary collections"],
      ["Document ingestion (PDF, Excel)", "work", "Hyperlean extraction and normalisation pipeline"],
      ["Cost and abuse controls", "work", "Redis quotas at Hyperlean; Postgres limits at Buon Gusto"],
    ],
  },
  {
    title: "Backend",
    items: [
      ["FastAPI", "work", "Hyperlean RAG API with roles and health checks"],
      ["PostgreSQL", "work", "Buon Gusto (Postgres 17); Slotbook (Postgres 16, own migrations)"],
      ["Supabase: Auth, RLS, Edge Functions", "work", "Buon Gusto, Prontix"],
      ["REST APIs and OpenAPI", "work", "Hyperlean (Swagger UI); Slotbook, Hostwatch"],
      ["Redis", "work", "Hyperlean per-user rate limits and token quotas"],
      ["Real-time: SSE, Web Push", "work", "Buon Gusto notifications; Hostwatch live stream"],
    ],
  },
  {
    title: "Linux, cloud and delivery",
    items: [
      ["AWS EC2, security groups", "work", "Hyperlean backend and Qdrant; Shipyard runbook"],
      ["Docker and Docker Compose", "work", "Qdrant at Hyperlean; Shipyard production stack"],
      ["Linux hardening (UFW, SSH, updates)", "work", "Hyperlean EC2 host; Shipyard bootstrap"],
      ["CI/CD with GitHub Actions", "project", "Shipyard: tests, scans, approval gate, rollback"],
      ["Netlify", "work", "Buon Gusto (custom domain), Prontix, Stepvia, this site"],
    ],
  },
];

export const experience = [
  {
    when: "2026 – now",
    title: "Software developer, client projects",
    org: "Pizzeria Buon Gusto, Prontix, Stepvia International Education",
    evidence: "built",
    points: [
      "Designed and built the ordering platform and back-office for Pizzeria Buon Gusto: Supabase Postgres with 14 tables, row-level security on every table, server-side pricing, an order state machine enforced in the database, stock, delivery slots and zones.",
      "Added an OpenAI assistant that answers only from live menu, stock and order data, with model fallback and abuse limits; Web Push and email notifications on every order change; live chat handing customers over to staff.",
      "Built the Prontix site and client area (Google and email sign-in, document upload, credit-metered questions over customers' documents) and the Stepvia site in English, French and Arabic.",
    ],
  },
  {
    when: "Oct 2025 – Mar 2026",
    title: "AI chatbot and software developer",
    org: "Hyperlean S.r.l.",
    evidence: "thesis",
    points: [
      "Designed and built a RAG virtual assistant for an industrial cost-estimation and quoting application: FastAPI backend, Qdrant vector database and OpenAI models, integrated into the existing VB.NET desktop client.",
      "Built the ingestion pipeline for PDF, Excel and text documentation (extraction, normalisation, chunking, embeddings), fixing noisy PDF and spreadsheet extraction that was degrading retrieval.",
      "Deployed on AWS EC2 with Docker and layered security (security groups, API keys, UFW); added per-user rate limits and daily token quotas in Redis, model fallback, output caps and a health endpoint.",
      "Added a multilingual technical glossary applied after generation, separate production and development knowledge bases, and evaluated the assistant with guided conversational tests. The project became my BSc thesis.",
    ],
  },
  {
    when: "Sep 2024 – Feb 2025",
    title: "Software developer",
    org: "Food & More di Mahfouz Oussama S.A.S.",
    evidence: "cv",
    points: [
      "Worked on an order-management application: requirements, core features, functional testing and debugging.",
      "Built web interfaces in HTML, CSS and JavaScript, integrated a relational database and managed code with Git.",
    ],
  },
];

export const education = [
  { when: "Jul 2026 – now", title: "MSc in Computer Science (LM-18)", org: "University of Camerino", note: null },
  {
    when: "2023 – 2026",
    title: "BSc in Computer Science (L-31)",
    org: "University of Camerino",
    note: 'Thesis: "Design and experimental evaluation of a RAG virtual assistant supporting an industrial quoting tool". Supervisor Prof. Lorenzo Rossi.',
  },
];

export const certifications = [
  { title: "Java Programming and Software Engineering Fundamentals", org: "Duke University on Coursera" },
  { title: "Beginning C++ Programming – From Beginner to Beyond", org: "Online course" },
];
