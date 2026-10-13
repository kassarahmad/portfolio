// Traduction française. Même structure que le contenu anglais de src/content ;
// la build échoue s'il manque une phrase. Noms de technologies et code inchangés.

const L = null;

export default {
  profile: {
    role: "Ingénieur logiciel : développement full-stack, intégration de l'IA, Linux et infrastructure cloud",
    availability: "Ouvert aux postes junior en Italie ou à distance",
    location: "Ancône, Italie",
    lede:
      "Je construis des logiciels que des entreprises utilisent chaque jour : chez Hyperlean, un assistant RAG qui répond aux ingénieurs à partir de leur documentation technique ; " +
      "pour une pizzeria d'Ancône, une plateforme de commande avec ses règles dans la base de données et un assistant IA ; et des services que je déploie moi-même avec Docker sur Linux et AWS. " +
      "Licence en informatique à l'Université de Camerino ; actuellement en master.",
    about: [
      "J'aime la partie du logiciel qui commence une fois la démo terminée : rendre les réponses fiables, garder les coûts prévisibles, décider de ce qui se passe quand un service tombe, et pouvoir redéployer demain. Chez Hyperlean, cela voulait dire nettoyer la documentation PDF et Excel avant qu'elle n'atteigne le modèle, limiter par utilisateur une API payante et apprendre à l'assistant à dire quand il ne sait pas. Pour un restaurant, cela voulait dire imposer les prix et les états des commandes dans la base de données, pour qu'un navigateur modifié ne puisse pas les changer.",
      "J'ai surtout travaillé pour des PME : un éditeur de logiciels industriels, un restaurant qui reçoit des commandes chaque soir, une agence qui répond aux familles en trois langues, une marque qui vend des outils d'IA. Je cherche un poste junior en développement full-stack, backend, IA ou platform engineering, pour continuer à apprendre auprès de personnes qui gèrent des systèmes plus grands que les miens.",
    ],
    languages: [
      ["Arabe", "langue maternelle"],
      ["Italien", "C1, professionnel"],
      ["Anglais", "B2, professionnel"],
      ["Français", "B1, niveau de travail"],
    ],
  },
  skillGroups: [
    {
      title: "Langages",
      items: [
        ["Python", L, "Backend RAG d'Hyperlean (FastAPI) ; agent de Hostwatch"],
        ["TypeScript / JavaScript", L, "Edge functions de Buon Gusto et Prontix ; Slotbook, Hostwatch"],
        ["SQL et PL/pgSQL", L, "Buon Gusto : 25 fonctions en base, contraintes et politiques d'accès"],
        ["VB.NET", L, "Intégration au client de bureau d'Hyperlean"],
        ["Java, C++", L, "Cours universitaires et cours en ligne"],
      ],
    },
    {
      title: "IA et données",
      items: [
        [
          "Retrieval-augmented generation",
          L,
          "Assistant d'Hyperlean ; réponses de Buon Gusto fondées sur le menu et les commandes",
        ],
        ["API OpenAI, embeddings", L, "Hyperlean, Buon Gusto, Prontix ; modèle de secours"],
        ["Base vectorielle Qdrant", L, "Hyperlean : collections documents, développement et glossaire"],
        ["Ingestion de documents (PDF, Excel)", L, "Chaîne d'extraction et de normalisation d'Hyperlean"],
        ["Maîtrise des coûts et des abus", L, "Quotas Redis chez Hyperlean ; limites Postgres chez Buon Gusto"],
      ],
    },
    {
      title: "Backend",
      items: [
        ["FastAPI", L, "API RAG d'Hyperlean avec rôles et contrôles de santé"],
        ["PostgreSQL", L, "Buon Gusto (Postgres 17) ; Slotbook (Postgres 16, migrations maison)"],
        ["Supabase : Auth, RLS, Edge Functions", L, "Buon Gusto, Prontix"],
        ["API REST et OpenAPI", L, "Hyperlean (Swagger UI) ; Slotbook, Hostwatch"],
        ["Redis", L, "Limites de requêtes et quotas de tokens par utilisateur chez Hyperlean"],
        ["Temps réel : SSE, Web Push", L, "Notifications de Buon Gusto ; flux en direct de Hostwatch"],
      ],
    },
    {
      title: "Linux, cloud et livraison",
      items: [
        ["AWS EC2, groupes de sécurité", L, "Backend et Qdrant d'Hyperlean ; runbook de Shipyard"],
        ["Docker et Docker Compose", L, "Qdrant chez Hyperlean ; stack de production de Shipyard"],
        ["Durcissement Linux (UFW, SSH, mises à jour)", L, "Hôte EC2 d'Hyperlean ; préparation d'hôte de Shipyard"],
        ["CI/CD avec GitHub Actions", L, "Shipyard : tests, analyses, validation manuelle, retour arrière"],
        ["Netlify", L, "Buon Gusto (domaine propre), Prontix, Stepvia, ce site"],
      ],
    },
  ],
  experience: [
    {
      when: "2026 – aujourd'hui",
      title: "Développeur logiciel, projets clients",
      org: "Pizzeria Buon Gusto, Prontix, Stepvia International Education",
      points: [
        "Conception et réalisation de la plateforme de commande et du back-office de la Pizzeria Buon Gusto : Supabase Postgres avec 14 tables, row-level security sur chaque table, prix calculés côté serveur, machine à états des commandes imposée par la base, stock, créneaux et zones de livraison.",
        "Ajout d'un assistant OpenAI qui ne répond qu'à partir du menu, du stock et des commandes en temps réel, avec modèle de secours et limites contre les abus ; notifications push et e-mail à chaque changement d'état ; chat en direct qui passe le client à l'équipe.",
        "Réalisation du site et de l'espace client de Prontix (connexion Google et e-mail, envoi de documents, questions payées en crédits sur les documents du client) et du site de Stepvia en anglais, français et arabe.",
      ],
    },
    {
      when: "oct. 2025 – mars 2026",
      title: "Développeur de chatbots IA et de logiciels",
      org: "Hyperlean S.r.l.",
      points: [
        "Conception et développement d'un assistant virtuel RAG pour une application industrielle d'estimation des coûts et de devis : backend FastAPI, base vectorielle Qdrant et modèles OpenAI, intégré au client de bureau VB.NET existant.",
        "Construction de la chaîne d'ingestion pour la documentation PDF, Excel et texte (extraction, normalisation, découpage, embeddings), en corrigeant l'extraction bruitée des PDF et des tableurs qui dégradait la recherche.",
        "Déploiement sur AWS EC2 avec Docker et une sécurité en couches (groupes de sécurité, clés d'API, UFW) ; ajout de limites par utilisateur et de quotas quotidiens de tokens dans Redis, d'un modèle de secours, de plafonds de réponse et d'un point de contrôle de santé.",
        "Ajout d'un glossaire technique multilingue appliqué après la génération, de bases de connaissances séparées pour la production et le développement, et évaluation de l'assistant par des conversations guidées. Le projet est devenu mon mémoire de licence.",
      ],
    },
    {
      when: "sept. 2024 – févr. 2025",
      title: "Développeur logiciel",
      org: "Food & More di Mahfouz Oussama S.A.S.",
      points: [
        "Travail sur une application de gestion des commandes : analyse des besoins, fonctionnalités principales, tests fonctionnels et débogage.",
        "Réalisation d'interfaces web en HTML, CSS et JavaScript, intégration d'une base de données relationnelle et gestion du code avec Git.",
      ],
    },
  ],
  education: [
    {
      when: "juil. 2026 – aujourd'hui",
      title: "Master en informatique (LM-18)",
      org: "Université de Camerino",
      note: null,
    },
    {
      when: "2023 – 2026",
      title: "Licence en informatique (L-31)",
      org: "Université de Camerino",
      note: "Mémoire : « Conception et évaluation expérimentale d'un assistant virtuel RAG au service d'un outil de devis industriel ». Directeur : Prof. Lorenzo Rossi.",
    },
  ],
  certifications: [
    { title: "Java Programming and Software Engineering Fundamentals", org: "Duke University sur Coursera" },
    { title: "Beginning C++ Programming – From Beginner to Beyond", org: "Cours en ligne" },
  ],
  projects: {
    "hyperlean-rag-assistant": {
      title: "Assistant RAG pour l'estimation des coûts industriels",
      summary:
        "Un assistant virtuel développé chez Hyperlean qui répond aux questions sur une application industrielle d'estimation des coûts et de devis en s'appuyant uniquement sur sa documentation, déployé sur AWS avec maîtrise des coûts et des abus. C'est aussi mon mémoire de licence.",
      status: "Livré chez Hyperlean",
      role: "Développeur : backend RAG, chaîne d'ingestion, intégration au client de bureau, déploiement AWS, évaluation",
      org: "Hyperlean S.r.l.",
      problem:
        "Les ingénieurs qui estiment des coûts de production travaillent dans une application de bureau technique, pleine de paramètres, de règles de validité et d'étapes de configuration. Le savoir nécessaire existe, mais il est dispersé entre manuels PDF, tableaux Excel de paramètres et notes de procédure : chaque doute oblige à interrompre la tâche pour chercher. Un chatbot générique répondrait avec aplomb mais sans lien avec la documentation de l'entreprise, et en estimation des coûts un paramètre inventé peut changer un devis. Le but était un assistant intégré à l'application, qui réponde à partir de la documentation et dise clairement quand la réponse n'y figure pas.",
      users: [
        "Les utilisateurs de l'application d'estimation et de devis qui ont besoin de procédures, de définitions et d'étapes de configuration pendant leur travail.",
        "Les administrateurs qui tiennent à jour la base de connaissances et le glossaire technique.",
      ],
      features: [
        "Questions posées depuis l'application de bureau VB.NET existante, en gardant les derniers échanges comme contexte de conversation.",
        "Réponses fondées sur les passages retrouvés dans la documentation (Retrieval-Augmented Generation), avec des étapes numérotées pour les procédures.",
        "Une réponse explicite « absent de la documentation » pour les questions hors base de connaissances, plutôt qu'une supposition.",
        "Ingestion des documents PDF, Excel et texte par une seule chaîne : extraction, nettoyage, découpage, embeddings, stockage dans Qdrant.",
        "Réponses dans la langue de la question ; un glossaire technique contrôlé garde les termes métier cohérents d'une langue à l'autre.",
        "Rôles séparés pour l'interrogation et l'administration, bases de connaissances distinctes pour la production et le développement, et un point de contrôle qui vérifie chaque dépendance.",
      ],
      diagram: {
        title: "Architecture de l'assistant RAG",
        caption:
          "Le client de bureau ne parle qu'au backend. Clés, recherche, prompts et limites sont tous sur le serveur : l'assistant peut évoluer sans livrer un nouveau client.",
      },
      decisions: [
        {
          title: "Le client ne touche jamais au modèle ni à la base",
          body: "Les premiers prototypes appelaient l'API du modèle directement depuis le client de bureau. La version finale a tout placé derrière FastAPI : le client envoie une question avec une clé d'API et reçoit une réponse. Les clés OpenAI et Qdrant restent sur le serveur, et les changements de découpage, de prompts ou de recherche atteignent tous les utilisateurs sans nouvelle version du client.",
        },
        {
          title: "La qualité des données d'abord",
          body: "L'extraction brute des PDF produisait des mots coupés, des en-têtes répétés et des espacements aléatoires ; celle des fichiers Excel des lignes de cellules vides `| | |`. Les deux polluaient les embeddings. Un extracteur PDF page par page avec normalisation et un extracteur Excel qui réécrit les lignes en phrases `champ : valeur` ont rendu la recherche nettement plus pertinente. La leçon principale du mémoire : la qualité des réponses se joue à l'ingestion, avant même le modèle.",
        },
        {
          title: "Dire « je ne sais pas » est une fonctionnalité",
          body: "Le prompt système n'autorise que des réponses tirées du contexte retrouvé et demande au modèle de signaler quand la documentation ne couvre pas la question. Lors de l'évaluation, une question sur le prix de la licence, absent de la documentation, a reçu un constat explicite de cette lacune plutôt qu'un chiffre plausible.",
        },
        {
          title: "Des coûts maîtrisés dans le backend, pas par l'espoir",
          body: "Un modèle peu coûteux traite les questions courantes, avec un modèle plus puissant en secours. La sortie est plafonnée (300 à 600 tokens, selon un niveau de verbosité). Redis impose 20 questions par utilisateur toutes les deux heures et un quota quotidien de tokens par utilisateur ; l'ingestion des administrateurs n'y est pas soumise. Budget et liste de modèles autorisés chez le fournisseur sont un filet de sécurité, pas le seul contrôle.",
        },
        {
          title: "La terminologie corrigée après la génération, pas par le prompt",
          body: "Les tests multilingues montraient la bonne langue mais des termes techniques instables, moitié en anglais, moitié traduits. Plutôt que de forcer le prompt, une collection séparée dans Qdrant contient les paires de termes validées par langue et par client ; après la génération, les termes trouvés sont remplacés de façon déterministe. Les identifiants sont dérivés du client, de la langue et du terme : recharger un CSV met à jour les entrées au lieu de les dupliquer.",
        },
        {
          title: "Une défense en couches sur AWS",
          body: "Qdrant tourne auto-hébergé dans Docker sur EC2, après un prototype sur Qdrant Cloud. L'accès est restreint trois fois : le groupe de sécurité (SSH depuis une seule adresse, Qdrant uniquement depuis des adresses autorisées), une clé d'API Qdrant obligatoire et un pare-feu UFW qui refuse tout par défaut sur l'hôte, avec des mises à jour régulières et des instantanés du volume pour la restauration.",
        },
      ],
      code: { caption: "Limite de requêtes par utilisateur avec Redis (logique du mémoire, Python)" },
      testing:
        "Évalué par des conversations guidées couvrant les usages réels de l'application : une procédure pas à pas, une définition métier, la configuration d'une stratégie d'analyse, un résumé en trois points, une question hors périmètre et des questions en anglais et en français. Chaque réponse a été jugée sur la pertinence, la clarté, le caractère opérationnel, la complétude, le comportement sans information et la cohérence de langue. La question hors périmètre a été traitée sans invention ; les tests de langue ont révélé le problème de terminologie qui a mené au glossaire. Le mémoire précise qu'il s'agit d'une évaluation qualitative sur un ensemble ciblé de cas, pas d'une mesure à grande échelle.",
      deployment:
        "Backend FastAPI et Qdrant auto-hébergé dans Docker sur AWS EC2 ; Redis pour les compteurs ; configuration et secrets en variables d'environnement ; collections séparées pour la production et le développement, pour tester de nouveaux documents sans gêner les utilisateurs ; `/health` vérifie l'API, OpenAI, Qdrant et la collection configurée. La croissance du stockage est estimée à partir du nombre de vecteurs (1 536 dimensions × 4 octets × un facteur de surcoût) et rapportée après chaque test d'ingestion.",
      limitations: [
        "La qualité des réponses dépend de la recherche : si le bon passage n'est pas retrouvé, même un modèle puissant ne peut rien y faire.",
        "La taille des fragments, le chevauchement et les règles de nettoyage doivent être réglés pour chaque type de document.",
        "L'évaluation est qualitative et limitée à des cas représentatifs ; il n'y a pas encore de mesures automatiques de qualité.",
        "Le code source et les captures d'écran appartiennent à l'entreprise et ne sont pas montrés ici.",
      ],
      roadmap: [
        "Mesures automatiques de qualité et un jeu fixe de questions de non-régression.",
        "Cache des questions et embeddings fréquents ; collections par client.",
        "Une bêta avec davantage d'utilisateurs pour recueillir des questions réelles et ambiguës.",
        "Recherche limitée aux documents dans la langue de la question.",
      ],
      contribution:
        "Réalisé pendant mon travail chez Hyperlean S.r.l. (octobre 2025 à mars 2026) et présenté comme mémoire de licence en informatique à l'Université de Camerino : « Conception et évaluation expérimentale d'un assistant virtuel RAG au service d'un outil de devis industriel » (directeur Prof. Lorenzo Rossi, codirectrice Prof. Irene Cappelli). L'application concernée n'est pas nommée, comme dans le mémoire.",
      ledger: [
        ["Architecture : client VB.NET, FastAPI, Qdrant sur EC2, OpenAI", L, "Mémoire, chapitre 4"],
        [
          "Corrections de l'extraction PDF et Excel et leur effet sur la recherche",
          L,
          "Mémoire 4.2, figures 4.2 à 4.4",
        ],
        ["Limite Redis, quota quotidien de tokens, plafonds de sortie, modèle de secours", L, "Mémoire 4.7"],
        ["Glossaire en post-traitement déterministe avec identifiants idempotents", L, "Mémoire 5.2.7"],
        ["Question hors périmètre traitée sans invention", L, "Mémoire, expérience 5"],
        ["Réalisé chez Hyperlean S.r.l.", L, "CV ; déclaré par Ahmad"],
        ["Code source", L, "Propriété de l'entreprise, non disponible"],
      ],
    },
    "buongusto-aspio": {
      title: "Pizzeria Buon Gusto",
      summary:
        "Commande en ligne, back-office pour l'équipe et un assistant IA pour une pizzeria au feu de bois à Aspio, près d'Ancône, en ligne sur son propre domaine.",
      status: "En production",
      role: "Développeur : base de données, edge functions, application web, déploiement",
      problem:
        "La pizzeria prenait les commandes par téléphone et WhatsApp pendant un créneau du soir court et chargé. Elle voulait que les clients commandent depuis leur téléphone à emporter, sur place ou en livraison, voient si la commande était acceptée et obtiennent des réponses sur le menu sans appeler, tandis que l'équipe disposait d'un espace séparé pour gérer commandes, menu, stock et livraisons.",
      users: [
        "Clients de la région d'Ancône qui commandent à emporter, sur place ou en livraison.",
        "L'équipe de la pizzeria, qui accepte ou refuse les commandes, affecte les livreurs et gère le stock depuis un espace que les clients ne voient jamais.",
      ],
      features: [
        "Inscription par code e-mail ou Google ; profil, adresse enregistrée et suppression du compte gérés par le client.",
        "Commande à emporter, sur place ou en livraison par créneaux de 15 minutes, avec zones de livraison par code postal, minimum de commande, frais de livraison et capacité par créneau.",
        "Un suivi des états en direct : reçue, acceptée, prête, en livraison, terminée, ou refusée avec le motif.",
        "Notifications push et e-mails aux couleurs de la pizzeria à chaque changement d'état ; alertes push à l'équipe pour les nouvelles commandes et les demandes d'aide.",
        "Produits marqués épuisés automatiquement quand un ingrédient manque, ou désactivés pour une seule journée.",
        "Un assistant qui répond sur le menu, les allergènes, la livraison et les dernières commandes du client, avec un bouton pour parler à une personne.",
      ],
      diagram: {
        title: "Architecture de Buon Gusto : application web, services Supabase, prestataires externes",
        caption:
          "Clients et équipe utilisent la même application web ; chaque écriture passe par une fonction de la base, et les changements de commande déclenchent les notifications via un webhook de la base.",
      },
      decisions: [
        {
          title: "Les règles métier vivent dans la base, pas dans le navigateur",
          body: "Les clients n'ont aucun droit d'insertion ni de modification sur les commandes. Ils appellent `place_order`, une fonction `SECURITY DEFINER` au `search_path` figé, qui ignore tout prix envoyé par le navigateur et recalcule chaque ligne à partir du menu et des suppléments, puis vérifie les horaires, la zone de livraison par code postal, le délai, la capacité du créneau, le minimum de commande et la disponibilité des ingrédients. Un navigateur modifié ne peut ni changer un prix ni commander un produit épuisé.",
        },
        {
          title: "L'état de la commande est une machine à états avec verrou de ligne",
          body: "`set_order_status` vérifie `is_staff()`, verrouille la ligne de la commande avec `SELECT … FOR UPDATE` et n'autorise que les transitions prévues dans la fonction (par exemple, seules les commandes en livraison peuvent partir en livraison). Si deux membres de l'équipe agissent en même temps sur la même commande, le second reçoit un message clair l'invitant à recharger au lieu d'écraser le premier.",
        },
        {
          title: "Les contraintes en dernière ligne de défense",
          body: "Type de commande, moyen de paiement et état sont des contraintes CHECK, les prix sont des entiers bornés en centimes, le stock ne peut pas devenir négatif et les réglages de livraison ont des plages autorisées. Même un bogue dans une fonction ne peut pas enregistrer une commande impossible.",
        },
        {
          title: "Row-level security sur chaque table",
          body: "Les 14 tables ont la RLS. Menu, zones et réglages sont lisibles par tous ; les clients ne voient que leurs commandes et leur profil (`customer_id = auth.uid()`) ; le stock et ses mouvements sont réservés à l'équipe. L'appartenance à l'équipe est une table séparée, pas un champ qu'un utilisateur pourrait modifier sur son profil.",
        },
        {
          title: "Un assistant qui ne peut répéter que ce que dit la base",
          body: "La fonction `assistente` reconstruit son contexte à partir des tables en direct (en cache 60 secondes) : produits visibles avec prix et allergènes, produits épuisés du jour, suppléments et zones de livraison actives, plus les trois dernières commandes du client connecté. Le prompt interdit d'inventer des prix ou des horaires et invite toujours les personnes allergiques à téléphoner. Il bascule sur un second modèle si le premier échoue et s'arrête aussitôt en cas d'erreur d'authentification ou de quota.",
        },
        {
          title: "Payer l'IA sans subir d'abus",
          body: "Chaque requête est limitée par appelant (25 par heure, identifié par un hachage salé de l'IP pour ne pas stocker les adresses) et globalement (500 par jour), avec une table de compteurs dans Postgres pour que les limites tiennent entre instances de la fonction. Les requêtes ne viennent que des origines du site, et l'historique de conversation est réduit aux 8 derniers messages, avec des limites de longueur.",
        },
      ],
      code: { caption: "Transitions d'état autorisées, extrait de set_order_status en production" },
      testing:
        "Le projet n'a pas encore de suite de tests automatisés. Pour cette revue, j'ai vérifié en lecture seule le schéma, les politiques RLS et les définitions des fonctions en production, et lancé le conseiller de sécurité de Supabase. Ajouter des tests est le premier point de la feuille de route ci-dessous.",
      deployment:
        "L'application web est un unique `index.html` envoyé sur Netlify, servi sur buongustoaspio.it avec une règle de redirection et trois règles d'en-têtes. Les changements de base sont des migrations Supabase (21 à ce jour) ; les edge functions sont déployées sur Supabase avec les secrets en variables d'environnement.",
      review: {
        public: [
          "L'historique des migrations contient des migrations initiales répétées, ce qui complique plus que nécessaire la reconstruction de la base à partir de zéro.",
          "Quelques coquilles sur le site : une espace manquante dans le titre principal, des numéros d'étape en double dans le guide de commande et l'orthographe du compte Instagram.",
        ],
      },
      limitations: [
        "Pas de tests automatisés ni de CI ; les mises en ligne sont des envois manuels.",
        "Pas de paiement en ligne : les clients paient au comptoir ou au livreur.",
        "L'imprimante de bons de cuisine est prévue mais pas encore branchée.",
      ],
      roadmap: [
        "Tests de base de données pour `place_order` et `set_order_status` (pgTAP ou un lanceur de tests Node sur un Supabase local).",
        "Une chaîne CI avec recherche de secrets et contrôles automatiques avant chaque mise en ligne.",
        "Fusionner l'historique des migrations en une base propre.",
        "Intégration de l'imprimante de cuisine pour les commandes acceptées.",
      ],
      contribution:
        "Développé par Ahmad : le pied de page du site et les instructions de l'assistant le désignent comme développeur, les déploiements partent de son compte Netlify, et son CV mentionne un travail antérieur de gestion des commandes pour la même société.",
      ledger: [
        ["14 tables, 21 migrations, Postgres 17", L, "Catalogue Supabase, 13 oct. 2026"],
        ["RLS active sur toutes les tables ; politiques comme décrites", L, "pg_policies"],
        [
          "25 fonctions en base, toutes au search_path figé ; contrôles d'équipe via is_staff()",
          L,
          "Définitions dans pg_proc",
        ],
        [
          "Recalcul des prix et contrôles côté serveur dans place_order ; table des transitions et verrou dans set_order_status",
          L,
          "Corps des fonctions lus le 13 oct. 2026",
        ],
        ["Contexte de l'assistant, modèle de secours, limites, origines autorisées", L, "Edge function assistente"],
        ["Notifications push et e-mail aux changements de commande", L, "Edge function notify-order"],
        ["Pages clients, étapes de commande, moyens de paiement", L, "buongustoaspio.it"],
        ["Framework du frontend", L, "Impossible à déterminer sans le code de l'application"],
      ],
    },
    slotbook: {
      title: "Slotbook",
      summary:
        "Réservation de rendez-vous pour les petites entreprises de services : une API REST sur PostgreSQL avec rôles, sessions renouvelées et un client web, où la double réservation est impossible même sous requêtes simultanées.",
      status: "Projet du portfolio",
      role: "Conception, développement et tests",
      problem:
        "Coiffeurs, kinésithérapeutes et professeurs particuliers perdent du temps avec les réservations par téléphone et les après-midi réservés deux fois. Avec Slotbook, les clients choisissent un service, un jour et un horaire libre ; l'équipe voit son planning ; le responsable définit services, équipe et horaires de la semaine. Les difficultés : l'exactitude sous concurrence, les fuseaux horaires et la confidentialité des données de chacun.",
      users: [
        "Clients qui réservent et annulent des rendez-vous depuis leur téléphone.",
        "Membres de l'équipe qui consultent leur journée et marquent les rendez-vous comme honorés ou manqués.",
        "Le responsable, qui gère services, prix, équipe et horaires.",
      ],
      features: [
        "Rôles client, équipe et responsable, vérifiés par le serveur à chaque requête.",
        "Jetons d'accès de 15 minutes et jetons de rafraîchissement renouvelés dans un cookie HttpOnly, avec détection de réutilisation.",
        "Disponibilités calculées en SQL à partir des horaires (avec pauses) moins les réservations existantes, dans le fuseau horaire de l'entreprise.",
        "Réservation, annulation avec délai minimum pour le client, suivi des rendez-vous honorés et manqués.",
        "Recherche, filtres, tri et pagination sur les listes ; modification du compte, changement de mot de passe et suppression.",
        "Description OpenAPI 3.1 servie par l'API, plus une page de documentation lisible.",
      ],
      screenshots: [
        {
          alt: "Réservation sur téléphone : liste des services, choix de la date et grille d'horaires libres avec 10:30 sélectionné.",
          caption: "Réservation sur un écran de téléphone. Les horaires viennent de la requête de disponibilité.",
        },
        {
          alt: "Planning du responsable : tableau des prochaines réservations avec service, membre de l'équipe, client, état et actions.",
          caption: "Planning du responsable avec des données de démonstration fictives.",
        },
      ],
      diagram: {
        title: "Chemin d'une requête dans Slotbook",
        caption:
          "Chaque requête passe par la limitation de débit, la vérification du jeton (avec le rôle relu en base), le contrôle des rôles et une validation stricte avant d'atteindre le traitement.",
      },
      decisions: [
        {
          title: "C'est la base qui rend la double réservation impossible",
          body: "Le chevauchement est empêché par une contrainte d'exclusion GiST sur `(staff_id, tstzrange(starts_at, ends_at))` pour les réservations non annulées. Les contrôles applicatifs donnent des messages clairs, mais seule la contrainte tient quand deux requêtes arrivent ensemble. Un test envoie trois requêtes qui se chevauchent au même instant et attend exactement un succès.",
        },
        {
          title: "Les fuseaux horaires traités là où vivent les données",
          body: "Les horaires de travail sont des heures locales. Le calcul des disponibilités les convertit avec `(date + start_time) AT TIME ZONE tz` avant de générer les créneaux : les jours de changement d'heure donnent quand même les bons horaires. À la création d'une réservation, le serveur revérifie horaires, délai et horizon ; le choix du client n'est jamais pris pour acquis.",
        },
        {
          title: "Des sessions qui résistent à un jeton volé",
          body: "Les jetons de rafraîchissement sont aléatoires, stockés uniquement sous forme de hachage et renouvelés à chaque usage. Chaque connexion forme une famille ; réutiliser un jeton déjà renouvelé révoque toute la famille. Le rôle inscrit dans un jeton d'accès n'est jamais cru : l'utilisateur est rechargé à chaque requête, donc une rétrogradation ou une suppression prend effet immédiatement.",
        },
        {
          title: "Aucune dépendance à l'exécution, par choix",
          body: "Le serveur n'utilise que la bibliothèque standard de Node et de petits modules du dépôt : un validateur, JWT et un client du protocole PostgreSQL avec authentification SCRAM et pool de connexions. La chaîne d'approvisionnement se réduit ainsi au runtime, dans un environnement sans registre de paquets. Le prix est de maintenir ce code : il est donc testé directement, et la couche base de données se cache derrière `query()` et `tx()`, si bien que passer à `pg` ne touche qu'un fichier.",
        },
      ],
      code: { caption: "L'invariant, extrait de migrations/001_init.sql" },
      testing:
        "12 tests unitaires (validation, hachage des mots de passe, JWT falsifiés et expirés, limitation de débit, configuration qui échoue en sécurité, secrets lus dans des fichiers, masquage des journaux, et vérification que le document OpenAPI correspond exactement au routeur), 23 tests d'intégration en HTTP sur une vraie base PostgreSQL 16 créée à chaque exécution, et 2 tests dans le navigateur au format téléphone. Deux mutations volontaires, supprimer la contrainte de chevauchement et casser la séparation entre clients, ont chacune fait échouer la suite. Le test de bout en bout a trouvé un vrai bogue : le rafraîchissement de session partageait la limite stricte de la connexion, si bien que quelques rechargements bloquaient l'utilisateur ; il a désormais sa propre limite.",
      deployment:
        "S'exécute dans un conteneur en lecture seule, sans root. Un fichier Docker Compose local lance PostgreSQL et l'API sur 127.0.0.1. Le déploiement en production est décrit dans Shipyard. Non publié en ligne.",
      limitations: [
        "Les limites de débit sont par processus ; plusieurs répliques demanderaient un limiteur partagé.",
        "Pas encore d'e-mails : ni vérification d'adresse, ni réinitialisation de mot de passe, ni rappels.",
        "Une entreprise par base de données.",
      ],
      roadmap: [
        "Vérification d'e-mail, réinitialisation du mot de passe et rappels via une file d'attente.",
        "Temps tampon entre deux rendez-vous.",
        "Flux iCal par membre de l'équipe.",
      ],
      contribution: "Réalisé pour ce portfolio. Le code, les tests et la documentation sont dans `projects/slotbook`.",
      ledger: [
        ["Requêtes simultanées pour un créneau : exactement une réussit", L, "Test d'intégration, PostgreSQL 16"],
        ["Un client ne peut pas lire les réservations des autres", L, "Test d'intégration ; contrôle par mutation"],
        ["La réutilisation d'un jeton de rafraîchissement révoque la famille de sessions", L, "Test d'intégration"],
        ["Réserver et annuler sur téléphone sans erreur dans la console", L, "Test Playwright"],
        ["Lint, vérification des types, formatage", L, "ESLint, tsc --checkJs, Prettier"],
        ["Fonctionne sur AWS", L, "Non déployé"],
      ],
    },
    hostwatch: {
      title: "Hostwatch",
      summary:
        "Un moniteur auto-hébergé pour serveurs Linux : un agent lit les chiffres du noyau lui-même, un serveur conserve l'historique et évalue les règles d'alerte, et un tableau de bord se met à jour en direct via Server-Sent Events.",
      status: "Projet du portfolio",
      role: "Conception, développement et tests",
      problem:
        "Une petite équipe qui gère quelques serveurs veut savoir quand un disque se remplit, qu'un service est tombé ou qu'un hôte ne répond plus, sans exploiter toute une stack Prometheus et Grafana. Hostwatch est la plus petite chose qui le fait correctement : de vraies métriques, un historique, des alertes qui n'oscillent pas et une page toujours à jour.",
      users: ["Développeurs et administrateurs d'une poignée de serveurs Linux ou d'instances VPS."],
      features: [
        "Agent sans dépendance : CPU à partir des écarts de `/proc/stat`, mémoire via `MemAvailable`, charge, uptime, débit réseau, occupation de chaque vrai disque, état des unités systemd et, en option, santé des conteneurs Docker.",
        "Tampon hors ligne : jusqu'à 360 mesures sont mises en file pendant que le serveur est injoignable, puis livrées dans l'ordre.",
        "Mode simulateur pour les démonstrations, chaque mesure simulée étant signalée dans les données et à l'écran.",
        "Règles d'alerte avec durée (CPU au-dessus de 90 % pendant 5 minutes), règles immédiates pour les disques, hôtes muets, services en échec et conteneurs malades ; les alertes survivent aux redémarrages et se ferment d'elles-mêmes.",
        "Tableau de bord en direct avec reconnexion et repli automatique sur l'interrogation périodique ; de 1 à 48 heures d'historique échantillonné par hôte.",
      ],
      screenshots: [
        {
          alt: "Vue d'ensemble : deux alertes critiques sur des services en haut, puis trois cartes d'hôtes : build-vm (réel, Critique) et db-1 et web-1 (marqués Simulés, OK) avec des barres de CPU, mémoire et disque.",
          caption:
            "Vue d'ensemble : build-vm est la vraie machine de développement ; db-1 et web-1 sont des hôtes simulés, signalés comme tels.",
        },
        {
          alt: "Détail de l'hôte build-vm avec graphiques de CPU, mémoire, disque et réseau. Le graphique du disque passe d'environ 91 % à 31 %.",
          caption:
            "Le graphique du disque garde la trace d'une vraie correction : un disque image en lecture seule à 91 % était signalé jusqu'à ce que l'agent apprenne à ignorer les systèmes de fichiers en lecture seule.",
        },
      ],
      diagram: {
        title: "Architecture de Hostwatch",
        caption:
          "Le jeton d'un agent ne peut envoyer de données que pour son propre hôte. Le serveur n'a jamais besoin d'accéder aux hôtes qu'il surveille.",
      },
      decisions: [
        {
          title: "Lire le noyau, pas une bibliothèque",
          body: "L'usage CPU est la variation des jiffies occupés sur la variation des jiffies totaux entre deux lectures de `/proc/stat`, sans le temps invité déjà compté. La mémoire utilise `MemAvailable` plutôt que la mémoire libre, qui ferait paraître plein n'importe quel système Linux à cause du cache. Les systèmes de fichiers virtuels et en lecture seule sont ignorés.",
        },
        {
          title: "Des alertes qui n'oscillent ni ne se répètent",
          body: "Une règle à seuil ne se déclenche qu'après que la condition a duré le temps prévu : un pic de 20 secondes reste silencieux. Chaque couple règle, hôte et sujet forme une seule alerte : deux services tombés font deux alertes. Les alertes ouvertes sont enregistrées, donc un redémarrage du serveur ne les renvoie pas.",
        },
        {
          title: "En direct, avec une solution de repli",
          body: "Le tableau de bord s'abonne via Server-Sent Events : une longue réponse HTTP que les proxys comprennent, avec des commentaires de battement de cœur pour que les connexions inactives ne soient pas coupées. Après trois reconnexions échouées, la page interroge le serveur toutes les 10 secondes tout en continuant à réessayer le flux, et l'indique dans l'en-tête.",
        },
        {
          title: "Moindre privilège sur les hôtes surveillés",
          body: "L'agent tourne comme unité systemd avec un utilisateur dynamique sans privilège, un système de fichiers en lecture seule, aucune capacité et un plafond mémoire de 64 Mo. Il n'a jamais besoin du socket Docker ; l'état des conteneurs devrait passer par un proxy qui n'autorise qu'un seul point d'accès en lecture.",
        },
      ],
      testing:
        "11 tests Python pour l'agent (lecture de fichiers `/proc` de test, écarts de CPU, disques en lecture seule, bornes du simulateur, livraison ordonnée de l'arriéré après une coupure) et 16 tests Node pour le serveur (durée et clôture des alertes, comportement au redémarrage, échantillonnage, validation, authentification, liaison des jetons aux hôtes et flux en direct). Un test exécute le vrai agent et passe sa sortie au validateur du serveur, pour que les deux ne divergent pas. Le test d'échantillonnage a trouvé un vrai bogue : SQLite divisait les horodatages en nombres décimaux, donc l'historique n'était pas regroupé du tout.",
      deployment:
        "Vérifié de bout en bout sur une VM Linux : un agent qui lit la vraie machine et deux agents simulés, avec des alertes qui se déclenchent et se ferment et le tableau de bord à jour dans un navigateur. Images Docker et unité systemd durcie incluses. Non publié en ligne.",
      limitations: [
        "`node:sqlite` est encore marqué expérimental dans Node 22.",
        "Un seul mot de passe pour le tableau de bord ; pas de comptes utilisateurs.",
        "CPU de l'hôte entier seulement ; pas encore de consommation par conteneur.",
      ],
      roadmap: [
        "CPU et mémoire par conteneur à partir des cgroups.",
        "Mise en sourdine pendant la maintenance.",
        "Un point d'accès Prometheus pour alimenter une stack existante.",
      ],
      contribution: "Réalisé pour ce portfolio. Le code, les tests et la documentation sont dans `projects/hostwatch`.",
      ledger: [
        [
          "Vraies métriques collectées sur une VM Linux et affichées en direct",
          L,
          "Exécuté sur la VM de développement, 13 oct. 2026",
        ],
        [
          "Les alertes se déclenchent après leur durée et se ferment",
          L,
          "Tests unitaires ; observé lors de l'exécution réelle",
        ],
        [
          "Le flux se reconnecte ; repli sur l'interrogation",
          L,
          "Code ; flux couvert par un test d'intégration, repli non testé dans le navigateur",
        ],
        ["La sortie de l'agent est acceptée par le serveur", L, "Test de contrat entre langages"],
        ["Les hôtes simulés sont signalés", L, "Champ de données et étiquette dans l'interface"],
      ],
    },
    prontix: {
      title: "Prontix",
      summary:
        "Site et espace client d'un service de logiciels, d'IA et d'automatisation pour les petites entreprises italiennes, avec connexion, envoi de documents et questions payées en crédits sur les documents du client.",
      status: "Site en ligne",
      role: "Développeur : site, espace client, backend Supabase",
      problem:
        "Les petites entreprises des Marches ont souvent besoin d'un site, d'un système de réservation ou d'un assistant IA, mais ne savent pas évaluer les offres techniques. Prontix présente ces services en italien simple, recueille les demandes et les prises de rendez-vous téléphoniques, et offre aux clients un espace pour essayer l'IA sur leurs propres documents.",
      users: [
        "Gérants de boutiques, de restaurants et de cabinets qui cherchent un logiciel ou une automatisation.",
        "Clients existants qui utilisent l'espace client pour envoyer des documents et poser des questions dessus.",
      ],
      features: [
        "Pages de services, de secteurs et de tarifs avec un formulaire de prise de rendez-vous et un formulaire de demande de projet.",
        "Connexion avec Google ou par e-mail et mot de passe, et un espace client.",
        "Envoi de documents (texte, Markdown, CSV, JSON jusqu'à 180 Ko chacun) et réponses tirées de ces documents, un crédit par question.",
        "Thèmes clair et sombre et une démonstration d'assistant IA avec des données inventées clairement signalées.",
      ],
      diagram: {
        title: "Architecture de Prontix",
        caption:
          "Les questions sur les documents exigent un utilisateur connecté et consomment un crédit dans la base avant l'appel au modèle.",
      },
      decisions: [
        {
          title: "Les crédits sont débités en base, avant l'appel au modèle",
          body: "En mode `rag`, la fonction retrouve l'utilisateur à partir de son jeton et appelle une fonction `use_credit`. OpenAI n'est appelé que si celle-ci réussit : un client ne peut pas obtenir de réponses au-delà de son solde en réessayant.",
        },
        {
          title: "Le choix du modèle est de la configuration, pas du code",
          body: "Le nom du modèle est lu dans un document de réglages d'administration, avec une valeur par défaut d'environnement : on peut le changer sans redéployer.",
        },
      ],
      review: {
        public: [
          "La page en ligne affiche un compte à rebours sans chiffre et un calculateur de coûts qui renvoie des zéros ; le lien Admin se trouve dans le pied de page public.",
        ],
      },
      testing:
        "Aucun test automatisé n'a été trouvé. La revue s'est limitée au site en ligne et au projet Supabase (en lecture seule).",
      deployment:
        "Site statique sur Netlify ; projet Supabase `fixflow` avec 4 tables et 6 edge functions (IA, notifications, traduction, e-mails d'authentification).",
      limitations: [
        "Sans le code du frontend, la structure des pages et la logique côté client n'ont pas pu être examinées.",
      ],
      roadmap: [
        "Tests automatisés et une chaîne CI pour le site et les edge functions.",
        "Corriger le compte à rebours et le calculateur ; retirer l'accès administrateur du pied de page public.",
      ],
      contribution:
        "Ahmad a réalisé le site et le backend Supabase ; les deux se trouvent dans son équipe Netlify et son organisation Supabase.",
      ledger: [
        ["Pages, formulaires, modes de connexion, limites d'envoi", L, "prontix-a.netlify.app"],
        ["Mode RAG payé en crédits, modèle lu dans les réglages", L, "Edge function ai"],
        ["Tables et edge functions", L, "Projet Supabase fixflow"],
        [
          "Lien entre Prontix et le projet fixflow",
          L,
          "Fonctionnalités correspondantes ; aucune configuration de déploiement ne les relie",
        ],
      ],
    },
    shipyard: {
      title: "Shipyard",
      summary:
        "La mise en production de Slotbook et Hostwatch sur un seul hôte AWS EC2 : Docker Compose derrière Caddy avec HTTPS automatique, sauvegardes vérifiées, déploiements contrôlés avec retour arrière automatique, et une chaîne CI/CD avec analyses et validation manuelle.",
      status: "Projet du portfolio",
      role: "Conception, scripts, pipelines et documentation",
      problem:
        "Deux applications qui fonctionnent ne sont que la moitié du travail. Il faut le TLS, des secrets hors des fichiers d'environnement, des sauvegardes que quelqu'un a vraiment restaurées, un déploiement qui ne peut pas laisser le site à moitié mis à jour, et une chaîne qui arrête une image vulnérable avant sa mise en ligne. Shipyard est cette couche, dimensionnée pour un seul serveur.",
      users: ["La personne d'astreinte pour un petit produit qui tourne sur un seul serveur."],
      features: [
        "Fichier Compose de production : seul Caddy publie des ports ; PostgreSQL est sur un réseau interne sans sortie vers internet ; conteneurs en lecture seule sans aucune capacité, avec limites de mémoire, contrôles de santé et rotation des journaux.",
        "Secrets en fichiers aux droits 600, montés comme secrets Docker ; les deux applications lisent des variables `NAME_FILE`.",
        "`deploy.sh` : sauvegarde vérifiée, récupération de l'image, migration, démarrage, contrôle de santé, retour arrière automatique si la nouvelle version n'est pas saine en 90 secondes.",
        "`backup.sh` et `restore.sh` : archives `pg_dump` vérifiées avec sommes de contrôle et rétention ; la restauration passe par une base temporaire et conserve celle qu'elle remplace.",
        "Préparation d'un hôte Ubuntu 24.04 : Docker depuis le dépôt signé, clés SSH uniquement, pare-feu, mises à jour de sécurité automatiques.",
        "CI : tests, ShellCheck, actionlint, gitleaks, analyses Trivy des images et des Dockerfile. Release : images avec SBOM et provenance de build. Déploiement : attend la validation d'un relecteur.",
      ],
      diagram: {
        title: "Déploiement avec Shipyard",
        caption:
          "Tout ce qui est à droite tourne sur une seule instance EC2. Seul Caddy est joignable depuis internet.",
      },
      decisions: [
        {
          title: "Un retour arrière sûr grâce à des migrations disciplinées",
          body: "Le retour arrière ne fait que relancer l'image précédente ; la base n'est pas touchée. C'est sûr parce que les migrations suivent le principe expand/contract : une version ajoute avant de retirer, et ne retire que ce que la version précédente ne lit plus. Le retour arrière des données reste une restauration distincte et délibérée, qui refuse de s'exécuter sans `--confirm`.",
        },
        {
          title: "Une sauvegarde n'en est une qu'une fois relue",
          body: "Chaque dump est listé avec `pg_restore --list` avant d'être conservé, et sa somme de contrôle est calculée. Les restaurations n'écrivent jamais directement sur la base en service : elles remplissent une base temporaire, échangent les noms et conservent l'ancienne.",
        },
        {
          title: "Tester les scripts, pas seulement les applications",
          body: "Les scripts de déploiement ne sont en général pas testés jusqu'à la nuit où l'on en a besoin. Ici, un faux `docker` permet à 19 tests de faire échouer la récupération d'image, la migration, la sauvegarde ou le contrôle de santé, et de vérifier que la version en service n'est jamais laissée en panne.",
        },
        {
          title: "Pas de Terraform tant qu'on ne peut pas planifier",
          body: "L'infrastructure se résume à une instance, un groupe de sécurité et une IP Elastic, documentés pas à pas. Terraform est l'étape suivante, mais l'écrire sans lancer `plan` sur un vrai compte reviendrait à affirmer plus que ce que le projet peut démontrer.",
        },
      ],
      testing:
        "19 tests de scripts avec une fausse CLI Docker (ordre du déploiement, retour arrière automatique, échec à chaque étape, validation des tags, garde-fous de la restauration, verrou). Le fichier Compose de production est résolu avec `docker compose config`, et le modèle obtenu a été vérifié : seul Caddy publie des ports, PostgreSQL est uniquement interne, les deux conteneurs applicatifs sont en lecture seule. Tous les fichiers YAML des workflows sont valides.",
      deployment:
        "Non déployé : aucune ressource AWS n'a été créée et aucun démon Docker n'était disponible pendant la réalisation. ShellCheck, actionlint, la validation du Caddyfile et les workflows eux-mêmes s'exécutent en CI, pas dans l'environnement de développement. Le README liste précisément ce qui a été vérifié et ce qui ne l'a pas été.",
      limitations: [
        "Un seul hôte, pas de haute disponibilité.",
        "Sauvegardes logiques quotidiennes : jusqu'à 24 heures de données en jeu.",
        "Les journaux restent sur l'hôte.",
      ],
      roadmap: [
        "Terraform avec `plan` en CI.",
        "Archivage WAL pour la restauration à un instant précis.",
        "Journaux vers CloudWatch avec alertes sur le taux d'erreurs.",
        "Déploiements blue/green derrière Caddy.",
      ],
      contribution:
        "Réalisé pour ce portfolio. Tous les fichiers sont dans `projects/shipyard` et `.github/workflows`.",
      ledger: [
        [
          "Logique de déploiement, retour arrière, sauvegarde et restauration",
          L,
          "19 tests avec une fausse CLI Docker",
        ],
        ["Exposition réseau : seul Caddy publie des ports", L, "docker compose config résolu"],
        ["Les workflows tournent sur GitHub Actions", L, "Non exécutés : dépôt non publié"],
        ["Fonctionne sur EC2 avec de vrais certificats", L, "Non déployé"],
      ],
    },
    stepvia: {
      title: "Stepvia International Education",
      summary:
        "Un site multilingue pour une agence qui aide des étudiants libanais à s'inscrire dans les universités italiennes, du choix de la formation à l'arrivée avec le visa.",
      status: "Site en ligne",
      role: "Développeur du site et de l'assistant",
      problem:
        "Les familles libanaises qui envisagent des études en Italie font face à un parcours inconnu : choix de l'université, candidatures, légalisation des documents, visa étudiant et titre de séjour. L'agence avait besoin d'un seul endroit pour expliquer les étapes, présenter ses formules et recueillir les demandes dans les langues de ses clients.",
      users: ["Futurs étudiants et leurs familles au Liban et dans les pays voisins."],
      features: [
        "Versions anglaise, française et arabe.",
        "Les six étapes du parcours, de la découverte à l'arrivée.",
        "Recherche d'universités par ville et langue d'enseignement.",
        "Trois formules de services avec ce qu'elles incluent et excluent.",
        "Un formulaire d'orientation gratuite avec un champ caché anti-spam, un contact WhatsApp et une connexion séparée pour les étudiants.",
        "Un assistant IA (« Ask Stepvia ») pour les questions sur les études en Italie, avec passage à l'équipe.",
      ],
      testing: "Le code source n'était pas disponible ; le contenu a été vérifié sur le site en ligne.",
      deployment: "Hébergé sur Netlify.",
      review: {
        public: [
          "Le délai du titre de séjour apparaît à la fois comme 8 jours et 8 jours ouvrés, et la page déclare l'anglais britannique comme langue.",
        ],
      },
      limitations: [
        "Le backend, le stockage des données et le fonctionnement de l'assistant n'ont pas pu être vérifiés.",
      ],
      roadmap: ["Partager le dépôt pour pouvoir examiner et documenter l'application étudiante et l'assistant."],
      contribution: "Le pied de page désigne Ahmad Kassar comme auteur du site.",
      ledger: [
        ["Langues, parcours, recherche, formules, formulaire, connexion, panneau assistant", L, "step-via.netlify.app"],
        ["Fonctionnement du backend et de l'assistant", L, "Code non disponible"],
      ],
    },
  },
};
