# Hostwatch

A small, self-hosted monitor for Linux servers. An agent on each host reads CPU, memory, disk, load, network, systemd services and (optionally) Docker containers straight from the kernel and sends them to a server, which stores history, evaluates alert rules and streams updates live to a dashboard.

**Status:** portfolio project, complete and tested. Verified end to end on a Linux VM with one real agent and two simulated ones; not deployed publicly.

```
 host A ── agent (Python, /proc) ──┐  HTTPS + per-host token
 host B ── agent ──────────────────┼──► server (Node.js) ── SQLite history (48 h default)
 demo   ── agent --simulate ───────┘        │  alert engine ──► webhook (optional)
                                            └─ SSE ──► dashboard (browser, password)
```

## Features

- **Agent** (`agent/hostwatch_agent.py`): Python 3.9+ standard library only. Reads `/proc/stat`, `/proc/meminfo`, `/proc/loadavg`, `/proc/uptime`, `/proc/net/dev`, `statvfs()` per mount, `systemctl is-active` for listed units, and container state from a Docker socket if you give it one. Skips virtual and read-only filesystems. Buffers up to 360 samples while the server is unreachable and sends them in order when it's back.
- **Simulator** (`--simulate`): plausible numbers with daily waves, spikes and occasional service failures. Every sample carries `"simulated": true` and the dashboard labels the host _Simulated_.
- **Server** (`server/`): Node.js 22, no runtime dependencies. Validates every sample strictly, binds each agent token to one host name, stores samples in SQLite with retention, downsamples history for charts, evaluates alert rules and pushes events over Server-Sent Events.
- **Alerts**: CPU and memory above 90% for 5 minutes, disk above 85%, host silent for 60 seconds, a listed service not active, a container stopped or unhealthy. Rules are configurable as JSON. Alerts persist across restarts and resolve automatically. Optional webhook (HTTPS) on every change.
- **Dashboard**: password sign-in, host overview with status and live CPU sparklines, per-host charts for 1 h to 48 h, disks, services and containers. Reconnects automatically; after repeated stream failures it switches to polling every 10 seconds and keeps retrying the stream.

## Run it locally

```bash
cd server
cp .env.example .env
node src/cli.js new-secret     # → HOSTWATCH_SESSION_SECRET
HOSTWATCH_PASSWORD='a long passphrase' node src/cli.js hash-password   # → HOSTWATCH_PASSWORD_HASH
node src/cli.js new-token      # one per host → HOSTWATCH_AGENT_TOKENS=web-1=<token>,...
npm run dev                    # http://localhost:4000

# In another terminal, on the same Linux machine (real data):
HOSTWATCH_TOKEN=<web-1 token> python3 agent/hostwatch_agent.py --server http://localhost:4000 --host web-1 --services nginx.service
# or simulated data on any OS:
HOSTWATCH_TOKEN=<token> python3 agent/hostwatch_agent.py --server http://localhost:4000 --host web-1 --simulate
# Inspect one sample without sending it:
python3 agent/hostwatch_agent.py --once
```

### Docker demo (simulated agents)

```bash
cp server/.env.example server/.env    # fill in as above with tokens for web-1 and db-1
SIM_WEB_TOKEN=<web-1 token> SIM_DB_TOKEN=<db-1 token> docker compose up --build
```

The Compose file never mounts the Docker socket or the host's `/proc` into a container.

### Monitoring real servers

Install the agent with the hardened systemd unit in [`agent/hostwatch-agent.service`](agent/hostwatch-agent.service): dynamic unprivileged user, read-only filesystem, no capabilities, 64 MB memory cap. Put the server behind HTTPS (see `../shipyard`), set `COOKIE_SECURE=true` and `TRUST_PROXY=true`.

For container status, don't give the agent the raw Docker socket (that's root on the host). Run a socket proxy that allows only `GET /containers/json` and point `HOSTWATCH_DOCKER_SOCKET` at it.

## Tests

```bash
cd server && npm test           # 16 tests: alert engine, storage, validation, auth, API, live stream
npm run test:agent              # 11 tests: /proc parsing, CPU deltas, read-only mounts, simulator, sender backlog
npm run lint && npm run typecheck && npm run format:check
```

One test runs the real agent (both `--simulate` and against the machine's `/proc`) and checks the server accepts its output, so agent and server can't drift apart silently.

## Configuration

| Variable                       | Default               | Meaning                                                              |
| ------------------------------ | --------------------- | -------------------------------------------------------------------- |
| `HOSTWATCH_SESSION_SECRET`     | required              | 32+ bytes; signs dashboard sessions. Rotating it signs everyone out. |
| `HOSTWATCH_PASSWORD_HASH`      | required              | scrypt hash from `cli.js hash-password`                              |
| `HOSTWATCH_AGENT_TOKENS`       | required              | `host=token` pairs, tokens 24+ characters                            |
| `HOSTWATCH_DB`                 | `./data/hostwatch.db` | SQLite file                                                          |
| `HOSTWATCH_RETENTION_HOURS`    | `48`                  | Sample history kept                                                  |
| `HOSTWATCH_RULES_FILE`         | built-in rules        | JSON list, see [`alerts.example.json`](alerts.example.json)          |
| `HOSTWATCH_ALERT_WEBHOOK`      | none                  | HTTPS URL that receives alert changes                                |
| `COOKIE_SECURE`, `TRUST_PROXY` | `true`, `false`       | Set for your proxy setup                                             |

## Security

- Agents authenticate with per-host bearer tokens, compared by hash in constant time; a token can only report for its own host.
- Samples are validated field by field and rebuilt from known fields, so unexpected properties are never stored. Bodies are capped at 64 KB; ingest is rate-limited per host.
- The dashboard needs a password (scrypt) and uses a signed, `HttpOnly`, `SameSite=Strict` cookie. Login is rate-limited and cross-site posts are refused.
- Strict Content-Security-Policy; the dashboard builds its DOM from text nodes only.
- Health (`/api/v1/health`) is the only unauthenticated read and reveals nothing about hosts.

## Known limitations

- `node:sqlite` is marked experimental in Node 22 (stable in later releases). It's isolated in `store.js`.
- Sessions are stateless: signing out clears the cookie but a copied cookie stays valid until it expires (12 h default) unless the secret is rotated.
- One dashboard password, no user accounts or roles.
- Alerts are evaluated on one server process; there's no high-availability mode.
- The agent's CPU figure is host-wide; per-process and per-container resource usage isn't collected.

## Roadmap

- Per-container CPU and memory from cgroups.
- Notification channels beyond a generic webhook (email, Telegram).
- Silence windows for planned maintenance.
- Prometheus exposition endpoint so the data can feed an existing stack.
