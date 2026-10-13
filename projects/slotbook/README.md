# Slotbook

Appointment booking for small service businesses (barbers, physiotherapists, tutors): customers pick a service, a day and a free time; staff see their schedule; the owner manages services, staff and weekly hours. A REST API on PostgreSQL with a small web client served by the same process.

**Status:** portfolio project, complete and tested locally. Not deployed publicly.

## What it does

- Accounts with email and password; roles `customer`, `staff`, `owner`, enforced on the server.
- Short-lived access tokens (JWT, 15 minutes) plus rotating refresh tokens in an `HttpOnly` cookie. Reusing an old refresh token revokes every session from that login.
- Services with duration and price; archive instead of delete so past bookings stay intact.
- Staff with the services they offer and weekly working hours (with breaks).
- Availability computed in SQL from working hours minus existing bookings, in the business's time zone, correct across daylight-saving changes.
- Booking, cancelling (customers only before a cutoff), completing and no-show marking.
- Search, filters, sorting and pagination on list endpoints.
- Account management: profile, password change (signs out other sessions), account deletion.
- OpenAPI 3.1 document at `/api/v1/openapi.json` and a readable page at `/docs`.

The invariant that matters most, **one staff member can't be booked twice for overlapping times**, is a PostgreSQL exclusion constraint, so it holds even when two requests arrive in the same millisecond. The test suite proves it by racing requests.

## Quick start

### With Docker

```bash
cp .env.example .env
# set PGPASSWORD and JWT_SECRET (openssl rand -base64 48)
docker compose up --build
docker compose exec api node scripts/cli.js seed-demo        # fictional demo data, prints sign-ins
docker compose exec -e SLOTBOOK_OWNER_PASSWORD='choose-a-long-one' api node scripts/cli.js create-owner you@example.com "Your Name"
```

Open http://localhost:3000. Both ports bind to `127.0.0.1` only.

### Without Docker

Requires Node.js 22.12+ and PostgreSQL 14+ (with the `btree_gist` and `citext` extensions, included in the standard contrib package).

```bash
createuser -P slotbook && createdb -O slotbook slotbook   # or use psql
cp .env.example .env    # fill in PG* values and JWT_SECRET
set -a; . ./.env; set +a
npm run migrate
npm run seed:demo
SLOTBOOK_OWNER_PASSWORD='choose-a-long-one' node scripts/cli.js create-owner you@example.com
npm run dev
```

There are no runtime dependencies, so there is nothing to `npm install` to run the server.

## Tests and checks

| Command                    | What it runs                                                                                                                                                                                                                              |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run test:unit`        | Validator, password hashing, JWT forgery and expiry, rate limiter, hours overlap, config fail-closed, log redaction, OpenAPI matches the router                                                                                           |
| `npm run test:integration` | 23 HTTP tests against a real PostgreSQL: auth flows and token reuse, role checks, validation, pagination and search, availability, concurrent double-booking, cancellation rules, visibility between users, account deletion, rate limits |
| `npm run test:e2e`         | Browser journey at phone width: sign up, book, cancel; inline validation errors (needs Playwright and a running server with demo data)                                                                                                    |
| `npm run lint`             | ESLint with explicit core rules                                                                                                                                                                                                           |
| `npm run typecheck`        | TypeScript `checkJs` over `src/` and `scripts/`                                                                                                                                                                                           |
| `npm run format:check`     | Prettier                                                                                                                                                                                                                                  |

Integration tests create and drop their own database, so they need a role allowed to `CREATE DATABASE`:

```bash
PGHOST=127.0.0.1 PGUSER=postgres PGPASSWORD=... npm run test:integration
```

## API at a glance

All under `/api/v1`. Full detail in `/docs`.

| Area     | Endpoints                                                                                                            |
| -------- | -------------------------------------------------------------------------------------------------------------------- |
| Auth     | `POST /auth/register`, `/auth/login`, `/auth/refresh`, `/auth/logout`                                                |
| Me       | `GET/PATCH/DELETE /me`, `POST /me/password`                                                                          |
| Services | `GET /services`, `GET /services/:id`, `POST`, `PATCH`, `DELETE` (owner)                                              |
| Staff    | `GET /staff`, `GET /staff/:id/hours`, `POST /staff`, `PATCH /staff/:id`, `PUT /staff/:id/hours` (owner)              |
| Booking  | `GET /availability`, `GET/POST /bookings`, `GET /bookings/:id`, `POST /bookings/:id/cancel`, `/complete`, `/no-show` |
| Ops      | `GET /health`, `GET /openapi.json`                                                                                   |

Errors always look like:

```json
{ "error": { "code": "slot_taken", "message": "That time was just taken. Pick another slot.", "requestId": "…" } }
```

## Configuration

Everything comes from environment variables; see [`.env.example`](.env.example). The server refuses to start without `JWT_SECRET` (32+ bytes), `PGUSER` and `PGDATABASE`, or with an invalid `BUSINESS_TZ`.

## Security

- Passwords hashed with scrypt (N=2¹⁵, r=8, p=1) and a random salt; logins take the same time whether or not the email exists.
- JWTs are HS256 only; `alg: none` and other algorithms are rejected. The user and role are re-read from the database on every request, so demotions and deletions apply immediately.
- Refresh tokens are random, stored only as SHA-256 hashes, rotated on every use, revoked on logout and password change.
- Every query is parameterised. Search text escapes `LIKE` wildcards. Request bodies are capped at 32 KB, must be JSON, and unknown fields are rejected.
- Authorization is server-side and row-scoped: customers can't see or touch other people's bookings (they get 404, not 403).
- Security headers on every response, including a strict Content-Security-Policy; the web client has no inline scripts or styles and builds the DOM with text nodes only.
- Logs are JSON lines with request ids; fields that look like passwords, tokens or cookies are redacted.

## Known limitations

- Rate limits are in memory, per process. With several replicas, enforce limits at the proxy or in a shared store.
- No email: there's no address verification, password reset or booking confirmation email.
- One business per database; no multi-tenant support.
- Times in the web client show in the browser's time zone; availability and hours use the business time zone.
- The PostgreSQL client in `src/lib/pg` is intentionally small. It's tested here, but a widely used driver (`pg`) would be the default choice in a team; `src/lib/pg/pool.js` is the only file to change.

## Roadmap

1. Email verification, password reset and booking reminders through a queue.
2. Buffer time between appointments and per-service staff overrides.
3. iCal feed per staff member.
4. Postgres-backed rate limiting for multi-instance deployments.

## Troubleshooting

| Symptom                                                 | Fix                                                                    |
| ------------------------------------------------------- | ---------------------------------------------------------------------- |
| `Invalid configuration: JWT_SECRET ...` on start        | Set a random value of at least 32 bytes.                               |
| `extension "btree_gist" is not available`               | Install your distribution's PostgreSQL contrib package.                |
| Signed in, then logged out after reload over plain http | Set `COOKIE_SECURE=false` for local http; keep it `true` behind HTTPS. |
| `429 rate_limited` while testing                        | Raise `RATE_LIMIT_AUTH_PER_MIN` locally.                               |
| `Migration ... was changed after it was applied`        | Don't edit applied migrations; add a new numbered file.                |

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for design decisions.
