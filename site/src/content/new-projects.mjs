// Case studies for the projects built in this repository (projects/*).
// Every number here comes from a test run recorded in docs/REPORT.md.

export const slotbook = {
  slug: "slotbook",
  title: "Slotbook",
  summary:
    "Appointment booking for small service businesses: a REST API on PostgreSQL with roles, rotating sessions and a web client, where double booking is impossible even under concurrent requests.",
  status: "Portfolio project",
  categories: ["full-stack", "backend"],
  period: "2026",
  role: "Design, implementation and tests",
  stack: ["Node.js 22", "PostgreSQL 16", "SQL", "OpenAPI 3.1", "Vanilla JavaScript", "Docker", "Playwright"],
  repoPath: "projects/slotbook",
  links: [],
  featured: true,
  problem:
    "Barbers, physiotherapists and tutors lose time to phone bookings and double-booked afternoons. Slotbook lets customers pick a service, a day and a free time; staff see their schedule; the owner sets services, staff and weekly hours. The hard parts are correctness under concurrency, time zones, and keeping each person's data private.",
  users: [
    "Customers booking and cancelling appointments from a phone.",
    "Staff seeing their day and marking appointments completed or no-show.",
    "The owner managing services, prices, staff and working hours.",
  ],
  features: [
    "Customer, staff and owner roles, enforced on the server on every request.",
    "15-minute access tokens plus rotating refresh tokens in an HttpOnly cookie, with reuse detection.",
    "Availability computed in SQL from working hours (with breaks) minus existing bookings, in the business's time zone.",
    "Booking, cancellation with a customer cutoff, completion and no-show tracking.",
    "Search, filters, sorting and pagination on list endpoints; account editing, password change and deletion.",
    "OpenAPI 3.1 description served by the API, plus a readable documentation page.",
  ],
  screenshots: [
    {
      src: "/img/slotbook-book-mobile.webp",
      w: 780,
      h: 1560,
      alt: "Booking flow on a phone: service list, date picker and a grid of free times with 10:30 selected.",
      caption: "Booking at phone width. Times come from the availability query.",
    },
    {
      src: "/img/slotbook-manage.webp",
      w: 1600,
      h: 1013,
      alt: "Owner's schedule view: a table of upcoming bookings with service, staff member, customer, status and actions.",
      caption: "Owner schedule with fictional demo data.",
    },
  ],
  diagram: {
    id: "sb",
    width: 780,
    height: 250,
    title: "Slotbook request path",
    nodes: [
      { id: "web", x: 20, y: 95, w: 150, h: 56, label: "Web client", sub: "no framework, strict CSP" },
      {
        id: "app",
        x: 230,
        y: 70,
        w: 210,
        h: 106,
        label: "Node.js HTTP pipeline",
        sub: "limits · auth · roles · validation",
      },
      { id: "mods", x: 500, y: 20, w: 120, h: 48, label: "Modules", sub: "auth, bookings, …" },
      { id: "db", x: 500, y: 170, w: 120, h: 60, label: "PostgreSQL", sub: "exclusion constraint", kind: "store" },
      { id: "spec", x: 660, y: 20, w: 100, h: 48, label: "OpenAPI", kind: "ext" },
    ],
    edges: [
      { from: "web", to: "app", label: "JSON + Bearer", labelAt: [200, 114] },
      { from: "app", to: "mods", sides: ["right", "left"] },
      { from: "mods", to: "db", sides: ["bottom", "top"], label: "parameterised SQL", labelAt: [612, 125] },
      { from: "mods", to: "spec", sides: ["right", "left"] },
    ],
    caption:
      "Every request passes rate limiting, token verification (with the user's role re-read from the database), role checks and strict validation before a handler runs.",
  },
  decisions: [
    {
      title: "The database makes double booking impossible",
      body: "Overlap is prevented by a GiST exclusion constraint on `(staff_id, tstzrange(starts_at, ends_at))` for non-cancelled bookings. Application checks give friendly messages, but only the constraint holds when two requests arrive together. A test fires three overlapping requests at once and expects exactly one success.",
    },
    {
      title: "Time zones handled where the data lives",
      body: "Working hours are wall-clock times. Availability converts them with `(date + start_time) AT TIME ZONE tz` before generating slots, so days when clocks change still produce correct times. Creating a booking re-checks hours, lead time and horizon on the server; the client's choice is never trusted.",
    },
    {
      title: "Sessions that survive a stolen token badly",
      body: "Refresh tokens are random, stored only as hashes and rotated on every use. Each login is a family; replaying an already-rotated token revokes the whole family. The role in an access token is never trusted: the user is reloaded per request, so a demotion or deletion takes effect immediately.",
    },
    {
      title: "Zero runtime dependencies, deliberately",
      body: "The server uses only Node's standard library plus small in-repo modules: a validator, JWT, and a PostgreSQL wire-protocol client with SCRAM authentication and pooling. That kept the supply chain to the runtime in an environment without a package registry. The cost is owning that code, so it's tested directly, and the database layer sits behind `query()` and `tx()` so swapping in `pg` touches one file.",
    },
  ],
  code: {
    caption: "The invariant, from migrations/001_init.sql",
    lang: "sql",
    text: `constraint bookings_no_overlap exclude using gist (
  staff_id with =,
  tstzrange(starts_at, ends_at, '[)') with &&
) where (status <> 'cancelled')`,
  },
  testing:
    "12 unit tests (validation, password hashing, JWT forgery and expiry, rate limiting, config failing closed, secrets from files, log redaction, and a check that the OpenAPI document matches the router exactly), 23 integration tests over HTTP against a real PostgreSQL 16 database created per run, and 2 browser tests at phone width. Two deliberate mutations, removing the overlap constraint and breaking per-customer scoping, each made the suite fail. The end-to-end test found a real bug: session refresh shared the strict login rate limit, so reloading a few times locked people out; refresh now has its own limit.",
  deployment:
    "Runs as a read-only, non-root container. A local Docker Compose file starts PostgreSQL and the API on 127.0.0.1. Production deployment is described in Shipyard. Not deployed publicly.",
  limitations: [
    "Rate limits are per process; several replicas would need a shared limiter.",
    "No email yet: no address verification, password reset or reminders.",
    "One business per database.",
  ],
  roadmap: [
    "Email verification, password reset and reminders through a queue.",
    "Buffer time between appointments.",
    "iCal feed per staff member.",
  ],
  contribution: "Built for this portfolio. All code, tests and documentation are in `projects/slotbook`.",
  ledger: [
    ["Concurrent requests for one slot: exactly one succeeds", "built", "Integration test, PostgreSQL 16"],
    ["Customers can't read other customers' bookings", "built", "Integration test; mutation check"],
    ["Refresh-token reuse revokes the session family", "built", "Integration test"],
    ["Book and cancel at phone width without console errors", "built", "Playwright test"],
    ["Lint, type check, formatting", "built", "ESLint, tsc --checkJs, Prettier"],
    ["Runs on AWS", "unknown", "Not deployed"],
  ],
};

export const hostwatch = {
  slug: "hostwatch",
  title: "Hostwatch",
  summary:
    "A self-hosted monitor for Linux servers: an agent reads the kernel's own numbers, a server stores history and evaluates alert rules, and a dashboard updates live over Server-Sent Events.",
  status: "Portfolio project",
  categories: ["backend", "frontend", "cloud"],
  period: "2026",
  role: "Design, implementation and tests",
  stack: [
    "Python 3 (standard library)",
    "Linux /proc",
    "systemd",
    "Node.js 22",
    "SQLite",
    "Server-Sent Events",
    "Docker",
  ],
  repoPath: "projects/hostwatch",
  links: [],
  featured: true,
  problem:
    "A small team running a few servers wants to know when a disk is filling, a service has died or a host has gone quiet, without operating a full Prometheus and Grafana stack. Hostwatch is the smallest thing that does that properly: real metrics, history, alert rules that don't flap, and a page that stays live.",
  users: ["Developers and administrators of a handful of Linux servers or VPS instances."],
  features: [
    "Agent with no dependencies: CPU from `/proc/stat` deltas, memory from `MemAvailable`, load, uptime, network throughput, disk usage per real mount, systemd unit state and, optionally, Docker container health.",
    "Offline buffer: up to 360 samples are queued while the server is down and delivered in order.",
    "Simulator mode for demos, with every simulated sample labelled in data and on screen.",
    "Alert rules with durations (CPU above 90% for 5 minutes), immediate rules for disks, silent hosts, failed services and unhealthy containers; alerts persist across restarts and resolve on their own.",
    "Live dashboard with reconnection and an automatic polling fallback; 1 to 48 hours of downsampled history per host.",
  ],
  screenshots: [
    {
      src: "/img/hostwatch-overview.webp",
      w: 1600,
      h: 625,
      alt: "Dashboard overview: two critical service alerts at the top, then three host cards: build-vm (real, Critical) and db-1 and web-1 (labelled Simulated, OK) with CPU, memory and disk bars.",
      caption: "Overview: build-vm is the real build machine; db-1 and web-1 are labelled simulated hosts.",
    },
    {
      src: "/img/hostwatch-host.webp",
      w: 1600,
      h: 1075,
      alt: "Host detail for build-vm with CPU, memory, disk and network charts. The disk chart drops from about 91% to 31%.",
      caption:
        "The disk chart records a real fix: a read-only image mount at 91% was being reported until the agent learned to skip read-only filesystems.",
    },
  ],
  diagram: {
    id: "hw",
    width: 780,
    height: 250,
    title: "Hostwatch architecture",
    nodes: [
      { id: "a1", x: 20, y: 20, w: 150, h: 48, label: "Agent on host", sub: "/proc, systemd" },
      { id: "a2", x: 20, y: 100, w: 150, h: 48, label: "Agent on host", sub: "Docker via proxy" },
      { id: "a3", x: 20, y: 180, w: 150, h: 48, label: "Simulated agent", sub: "labelled demo data", kind: "ext" },
      { id: "srv", x: 270, y: 80, w: 190, h: 88, label: "Server", sub: "validation · alert engine" },
      { id: "db", x: 540, y: 20, w: 120, h: 48, label: "SQLite", sub: "48 h history", kind: "store" },
      { id: "dash", x: 540, y: 100, w: 120, h: 48, label: "Dashboard", sub: "SSE, polling fallback" },
      { id: "hook", x: 540, y: 180, w: 120, h: 48, label: "Webhook", sub: "alert changes", kind: "ext" },
    ],
    edges: [
      { from: "a1", to: "srv", sides: ["right", "left"], label: "token per host", labelAt: [220, 38] },
      { from: "a2", to: "srv", sides: ["right", "left"] },
      { from: "a3", to: "srv", sides: ["right", "left"] },
      { from: "srv", to: "db", sides: ["right", "left"] },
      { from: "srv", to: "dash", sides: ["right", "left"] },
      { from: "srv", to: "hook", sides: ["right", "left"] },
    ],
    caption:
      "Each agent token can only report for its own host. The server never needs access to the hosts it watches.",
  },
  decisions: [
    {
      title: "Read the kernel, not a library",
      body: "CPU usage is the change in busy jiffies over the change in total jiffies between two reads of `/proc/stat`, excluding guest time that's already counted. Memory uses `MemAvailable` rather than free memory, which would make every Linux box look full because of the page cache. Virtual and read-only filesystems are skipped.",
    },
    {
      title: "Alerts that don't flap or repeat",
      body: "A threshold rule only fires after the condition has held for its duration, so a 20-second spike stays quiet. Each rule, host and subject pair is one alert, so two failed services are two alerts. Open alerts are stored, so restarting the server doesn't send them again.",
    },
    {
      title: "Live, with a way down",
      body: "The dashboard subscribes over Server-Sent Events: one long HTTP response that proxies understand, with heartbeat comments so idle connections aren't cut. After three failed reconnects the page polls every 10 seconds while it keeps retrying the stream, and says so in the header.",
    },
    {
      title: "Least privilege on monitored hosts",
      body: "The agent runs under a systemd unit with a dynamic unprivileged user, read-only filesystem, no capabilities and a 64 MB memory cap. It never needs the raw Docker socket; container state should come through a proxy that allows a single read-only endpoint.",
    },
  ],
  testing:
    "11 Python tests for the agent (parsing against fixture `/proc` files, CPU deltas, read-only mounts, simulator bounds, ordered delivery of the backlog after an outage) and 16 Node tests for the server (alert durations and resolution, restart behaviour, downsampling, validation, authentication, host binding of tokens, and the live stream). One test runs the real agent and feeds its output to the server's validator so the two can't drift apart. The downsampling test caught a real bug: SQLite was dividing timestamps as floats, so history wasn't being bucketed at all.",
  deployment:
    "Verified end to end on a Linux VM: one agent reading the real machine and two simulated agents, with alerts firing and resolving and the dashboard live in a browser. Docker images and a hardened systemd unit are included. Not deployed publicly.",
  limitations: [
    "`node:sqlite` is still marked experimental in Node 22.",
    "One dashboard password; no user accounts.",
    "Host-wide CPU only; no per-container resource usage yet.",
  ],
  roadmap: [
    "Per-container CPU and memory from cgroups.",
    "Maintenance silences.",
    "A Prometheus endpoint so the data can feed an existing stack.",
  ],
  contribution: "Built for this portfolio. All code, tests and documentation are in `projects/hostwatch`.",
  ledger: [
    ["Real metrics collected from a Linux VM and shown live", "built", "Run on the build VM, 13 Oct 2026"],
    ["Alerts fire after their duration and resolve", "built", "Unit tests; observed in the live run"],
    [
      "Stream reconnects; polling fallback",
      "built",
      "Code path; stream covered by integration test, fallback not browser-tested",
    ],
    ["Agent output accepted by the server", "built", "Cross-language contract test"],
    ["Simulated hosts are labelled", "built", "Data field and UI badge"],
  ],
};

export const shipyard = {
  slug: "shipyard",
  title: "Shipyard",
  summary:
    "The path to production for Slotbook and Hostwatch on one AWS EC2 host: Docker Compose behind Caddy with automatic HTTPS, verified backups, health-checked deploys with automatic rollback, and a CI/CD pipeline with scanning and a manual approval gate.",
  status: "Portfolio project",
  categories: ["cloud"],
  period: "2026",
  role: "Design, scripts, pipelines and documentation",
  stack: ["Docker Compose", "Caddy", "PostgreSQL", "Bash", "systemd", "GitHub Actions", "Trivy", "gitleaks", "AWS EC2"],
  repoPath: "projects/shipyard",
  links: [],
  featured: false,
  problem:
    "Two working applications are only half the job. They need TLS, secrets that aren't in environment files, backups someone has actually restored, a deploy that can't leave the site half-upgraded, and a pipeline that stops a vulnerable image before it ships. Shipyard is that layer, sized for a single server.",
  users: ["The person on call for a small product running on one server."],
  features: [
    "Production Compose file: only Caddy publishes ports; PostgreSQL is on an internal network with no route out; read-only containers with all capabilities dropped, memory limits, health checks and log rotation.",
    "Secrets as files with mode 600, mounted as Docker secrets; both applications read `NAME_FILE` variables.",
    "`deploy.sh`: verified backup, pull, migrate, start, health check, automatic rollback if the new release isn't healthy in 90 seconds.",
    "`backup.sh` and `restore.sh`: verified `pg_dump` archives with checksums and retention; restore goes through a scratch database and keeps the replaced one.",
    "Host bootstrap for Ubuntu 24.04: Docker from the signed repository, SSH keys only, firewall, automatic security updates.",
    "CI: tests, ShellCheck, actionlint, gitleaks, Trivy image and Dockerfile scans. Release: images with SBOM and build provenance. Deploy: waits for a reviewer's approval.",
  ],
  diagram: {
    id: "sy",
    width: 780,
    height: 270,
    title: "Shipyard deployment",
    nodes: [
      { id: "ci", x: 20, y: 20, w: 140, h: 48, label: "CI", sub: "tests · scans" },
      { id: "rel", x: 20, y: 100, w: 140, h: 48, label: "Release", sub: "images · SBOM" },
      { id: "dep", x: 20, y: 180, w: 140, h: 48, label: "Deploy", sub: "approval gate" },
      { id: "caddy", x: 260, y: 110, w: 130, h: 52, label: "Caddy", sub: ":80 :443 auto-TLS" },
      { id: "api", x: 450, y: 60, w: 140, h: 48, label: "slotbook-api", sub: "read-only" },
      { id: "hw", x: 450, y: 170, w: 140, h: 48, label: "hostwatch", sub: "read-only" },
      { id: "pg", x: 640, y: 60, w: 120, h: 48, label: "PostgreSQL", sub: "internal only", kind: "store" },
      { id: "bk", x: 640, y: 170, w: 120, h: 48, label: "Backups", sub: "local + S3", kind: "ext" },
    ],
    edges: [
      { from: "ci", to: "rel", sides: ["bottom", "top"] },
      { from: "rel", to: "dep", sides: ["bottom", "top"] },
      { from: "dep", to: "caddy", sides: ["right", "left"], label: "ssh deploy.sh", labelAt: [210, 196] },
      { from: "caddy", to: "api", sides: ["right", "left"] },
      { from: "caddy", to: "hw", sides: ["right", "left"] },
      { from: "api", to: "pg", sides: ["right", "left"] },
      { from: "pg", to: "bk", sides: ["bottom", "top"] },
    ],
    caption: "Everything on the right runs on one EC2 instance. Only Caddy is reachable from the Internet.",
  },
  decisions: [
    {
      title: "Rollback that's safe because migrations are disciplined",
      body: "Rolling back only restarts the previous image; the database isn't touched. That's safe because migrations follow expand/contract: a release adds before it removes, and only removes what the previous release no longer reads. Data rollback stays a separate, deliberate restore that refuses to run without `--confirm`.",
    },
    {
      title: "A backup isn't a backup until it's read back",
      body: "Each dump is listed with `pg_restore --list` before it's kept, and checksummed. Restores never write over the live database directly: they fill a scratch database, swap names, and keep the old one.",
    },
    {
      title: "Test the scripts, not just the apps",
      body: "Deployment scripts usually go untested until the night they're needed. Here a fake `docker` lets 19 tests make the pull, migration, backup or health check fail, and assert that the running release is never left broken.",
    },
    {
      title: "No Terraform until it can be planned",
      body: "The infrastructure is one instance, a security group and an Elastic IP, documented step by step. Terraform is the next step, but writing it without running `plan` against a real account would claim more than the project can show.",
    },
  ],
  testing:
    "19 script tests against a fake Docker CLI (deploy order, automatic rollback, failure at each step, tag validation, restore guards, locking). The production Compose file resolves with `docker compose config`, and the resolved model was checked: only Caddy publishes ports, PostgreSQL is internal only, both app containers are read-only. All workflow YAML parses.",
  deployment:
    "Not deployed: no AWS resources were created and no Docker daemon was available while building this. ShellCheck, actionlint, Caddyfile validation and the workflows themselves run in CI, not in the build environment. The README lists exactly what was and wasn't verified.",
  limitations: [
    "Single host, no high availability.",
    "Daily logical backups: up to 24 hours of data at risk.",
    "Logs stay on the host.",
  ],
  roadmap: [
    "Terraform with `plan` in CI.",
    "WAL archiving for point-in-time recovery.",
    "Logs to CloudWatch with alerts on error rate.",
    "Blue/green deploys behind Caddy.",
  ],
  contribution: "Built for this portfolio. All files are in `projects/shipyard` and `.github/workflows`.",
  ledger: [
    ["Deploy, rollback, backup and restore logic", "built", "19 tests with a fake Docker CLI"],
    ["Network exposure: only Caddy publishes ports", "built", "Resolved docker compose config"],
    ["Workflows run on GitHub Actions", "unknown", "Not run: repository not pushed"],
    ["Runs on EC2 with real certificates", "unknown", "Not deployed"],
  ],
};

export const houseServer = {
  slug: "kassar-house-server",
  title: "kassar-house-server",
  summary:
    "Tooling for a self-hosted home server: deduplicated, verifiable backups with retention and safe restores, health checks that notify only when something changes, and a LAN-only service stack behind one HTTPS proxy.",
  status: "Open source",
  categories: ["cloud", "backend", "open-source"],
  period: "2026",
  role: "Design, implementation, tests and documentation",
  stack: [
    "Python 3 (standard library)",
    "Linux /proc and /sys",
    "systemd",
    "Docker Compose",
    "Caddy",
    "Bash",
    "ufw",
    "GitHub Actions",
  ],
  repoUrl: "https://github.com/kassarahmad/kassar-house-server",
  links: [],
  featured: true,
  problem:
    "A home server is easy to start and easy to lose: one dead disk takes the passwords, photos and synced files with it, and nobody notices a full disk or a stopped container until something breaks. This project is the part that makes it dependable: backups that are checked and can actually be restored, alerts when a state changes, and services reachable from home but not from the internet.",
  users: ["Anyone running a few self-hosted services on a Debian, Ubuntu or Raspberry Pi machine at home."],
  features: [
    "`khs backup`: content-addressed snapshots on a second disk. Chunks are named by their SHA-256, stored once, compressed when it helps; unchanged files are not even re-read.",
    "`khs restore`: brings back content, modes, times, owners and symlinks, refuses paths or planted symlinks that lead outside the target, and keeps existing files unless asked to overwrite.",
    "`khs check --read-data`: re-hashes every chunk and names the snapshots that a missing or damaged chunk affects.",
    "Retention by last, day, ISO week, month and year, in local time, with a prune that never removes a chunk a kept snapshot uses.",
    "`khs health`: HTTP, TCP, disk, systemd, temperature, memory and backup-age checks; ntfy or webhook notifications only when a check changes state.",
    "Caddy with its own certificate authority in front of Vaultwarden, Jellyfin and Syncthing, answering only private addresses; ports bound to the LAN address.",
  ],
  diagram: {
    id: "khs",
    width: 780,
    height: 250,
    title: "kassar-house-server: services and backups",
    nodes: [
      { id: "lan", x: 20, y: 30, w: 150, h: 48, label: "LAN devices", sub: "https://*.home.arpa", kind: "ext" },
      { id: "caddy", x: 250, y: 30, w: 160, h: 48, label: "Caddy", sub: "internal CA, LAN only" },
      { id: "apps", x: 490, y: 30, w: 170, h: 48, label: "Vaultwarden, Jellyfin,", sub: "Syncthing" },
      { id: "data", x: 490, y: 160, w: 170, h: 48, label: "/srv/house", sub: "service data", kind: "store" },
      { id: "khs", x: 250, y: 160, w: 160, h: 48, label: "khs backup", sub: "nightly systemd timer" },
      { id: "repo", x: 20, y: 160, w: 150, h: 48, label: "Backup disk", sub: "chunks + manifests", kind: "store" },
    ],
    edges: [
      { from: "lan", to: "caddy", sides: ["right", "left"] },
      { from: "caddy", to: "apps", sides: ["right", "left"] },
      { from: "apps", to: "data", sides: ["bottom", "top"] },
      { from: "data", to: "khs", sides: ["left", "right"], label: "reads", labelAt: [450, 176] },
      { from: "khs", to: "repo", sides: ["left", "right"], label: "writes", labelAt: [210, 176] },
    ],
    caption:
      "The backup service can read everything but write only to the backup disk; the health timer (not drawn) checks the services, the disks and the age of the last backup.",
  },
  decisions: [
    {
      title: "A snapshot exists only once all its data does",
      body: "Chunks and manifests are written to a temporary file and renamed, and the manifest goes last. An interrupted backup therefore leaves no snapshot, only unreferenced chunks that `prune` removes. A `flock` keeps a backup and a prune from ever running at the same time.",
    },
    {
      title: "Restore as the riskiest operation",
      body: "A manifest could be damaged or crafted, and the target may already contain symlinks. Paths with `..` or a leading `/` are refused, directories are created one component at a time refusing symlinks, files are opened with `O_NOFOLLOW`, and links are created last. Owners are restored when running as root, because Syncthing or Jellyfin break if their data comes back owned by root.",
    },
    {
      title: "Least privilege, tested",
      body: "The nightly unit keeps only `CAP_DAC_READ_SEARCH` and may write only to the backup disk. Testing under exactly that capability set found a real bug: opening files with `O_NOATIME` needs ownership or `CAP_FOWNER`, so every file owned by another user was being skipped. There is now a regression test that runs the backup under `setpriv` with the unit's capabilities.",
    },
    {
      title: "Docker bypasses the firewall",
      body: "Published container ports are inserted ahead of ufw's rules, so a firewall alone doesn't keep them private. The stack binds every published port to the server's LAN address, Caddy answers 403 to non-private clients, and remote access is meant to go through a VPN instead of port forwarding.",
    },
  ],
  testing:
    "56 tests, standard library only: round trips comparing hashes, modes, times, owners and symlinks; deduplication and change detection (including an edit that restores the old mtime); interrupted backups; missing and corrupt chunks; restore attacks; retention by day, ISO week, month and year; health checks against a real local HTTP server and sockets; notifications only on change; and the setup script against a scratch root with recorded commands. Each safety check was mutation-tested: disabling it makes a test fail. Measured on the build VM: 49 MiB in 1,250 files backed up in 2.9 s (16.6 MiB stored), 0.12 s for an unchanged second run, byte-identical restore.",
  deployment:
    "`provision/setup.sh` installs `khs`, its configuration and two sandboxed systemd timers; `--harden` adds ufw for the LAN only, key-only SSH (skipped when no key is installed, rolled back if `sshd -t` rejects it) and automatic security updates. The Compose stack and the units are validated statically; CI also pulls every pinned image and validates the Caddyfile. Not yet run end to end on real home hardware.",
  limitations: [
    "Backups are not encrypted: the repository should live on an encrypted disk if it can leave the house.",
    "Fixed-size chunks, so inserting data in the middle of a large file re-stores the rest of it.",
    "No off-site target yet.",
    "The containers and timers have been validated but not run on real hardware.",
  ],
  roadmap: [
    "Off-site copy to an rclone remote, with encryption.",
    "Content-defined chunking.",
    "Scheduled restore drills.",
  ],
  contribution: "Designed and built for this portfolio, in its own repository.",
  ledger: [
    ["Backup, deduplication, restore and verify", "built", "56 tests; measured run on the build VM"],
    ["Backup under the systemd unit's capabilities", "built", "Regression test with setpriv"],
    ["Setup script: idempotent, dry run, SSH lockout guard", "built", "Tests against a scratch root"],
    ["Compose stack, Caddyfile, systemd units", "partial", "Validated statically; not run on home hardware"],
  ],
};

export const jtime = {
  slug: "jtime",
  title: "JTime",
  summary:
    "A JavaFX desktop app for planning projects and tracking how long tasks really take, with weekly and monthly time reports and CSV export. A university project I later hardened with tests, CI and data-safety fixes.",
  status: "Open source",
  categories: ["open-source"],
  period: "2026",
  role: "Developer: original app, then fixes, features and tests",
  stack: ["Java 21", "JavaFX 21", "Gradle", "JUnit 5", "GitHub Actions"],
  repoUrl: "https://github.com/kassarahmad/JTIME",
  links: [],
  featured: false,
  problem:
    "Estimates are only useful if you compare them with what actually happened. JTime keeps projects, tasks with an estimate, a calendar plan and the real time spent in one place, so the gap between the two is visible per project and per week.",
  users: ["Students and freelancers who plan their own work."],
  features: [
    "Projects that can only be closed when every task is done, and then accept no new tasks.",
    "Tasks with an estimate; completing one records the actual time and the date.",
    "A calendar plan without duplicates; completed tasks can't be planned.",
    "Reports per project (estimate, actual, deviation) and a time report for any range, with this-week and this-month shortcuts.",
    "Export as text, or all tasks as CSV that spreadsheets open safely.",
  ],
  decisions: [
    {
      title: "Reading the code before adding to it",
      body: "A review of the original version found data-loss bugs: planning changes were only written when something else triggered a save, an unreadable archive was silently replaced by an empty one and then overwritten, negative durations over an hour lost their hours in reports, and deleting a task left it in the calendar. Each now has a regression test.",
    },
    {
      title: "Safe saving and loading",
      body: "The archive is written to a temporary file and moved into place, so a crash can't corrupt it. Loading goes through an `ObjectInputFilter` that accepts only the app's own classes and the few JDK types they contain. An unreadable file is moved aside and reported, never overwritten.",
    },
    {
      title: "Compatible with existing data",
      body: "Completion dates were added as a new nullable field, so archives saved by version 1.0 still open; tasks completed before the change are counted separately in time reports instead of being dropped.",
    },
  ],
  testing:
    "20 JUnit 5 tests on the model, controllers, services and persistence, using the same wiring as the interface, a temporary archive and a fixed clock. Reintroducing each fixed bug makes a test fail. Maven Central wasn't reachable from the environment where the fixes were written, so the tests ran there through a minimal stand-in for the JUnit API, and the changed screen was type-checked against stubs of the JavaFX classes it uses. GitHub Actions runs the full Gradle build with real JUnit and JavaFX.",
  deployment:
    "Desktop application: `./gradlew run` with JDK 21. Data stays in a local file in the user's home directory.",
  limitations: [
    "Single user, local storage only.",
    "The interface is in Italian and has no automated UI tests.",
    "No running timer: actual time is entered when completing a task.",
  ],
  roadmap: ["Start/stop timer.", "SQLite storage with an import from the current archive.", "English interface."],
  contribution:
    "Original application written by Ahmad for a course at the University of Camerino; the 1.1 fixes, features, tests and CI are in the repository history.",
  ledger: [
    ["Fixes, time reports, CSV export", "built", "20 tests; old archives load"],
    ["Full build with JavaFX in CI", "unknown", "Workflow added; result not checked from the build environment"],
    ["Interface changes", "partial", "Type-checked against JavaFX stubs, not run"],
  ],
};
