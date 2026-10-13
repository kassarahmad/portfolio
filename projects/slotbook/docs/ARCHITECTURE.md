# Slotbook architecture

```
Browser (public/*.js, no framework)
   │  HTTPS, JSON, Bearer access token; refresh token in HttpOnly cookie
   ▼
Node.js http server (src/app.js)
   request id → security headers → CORS allow-list → rate limit (auth | session | api)
   → authenticate (JWT + current role from DB) → role check → JSON body (≤32 KB)
   → module handler → consistent error mapping → JSON access log
   │
   ├─ modules/auth.js      register, login, refresh rotation, logout
   ├─ modules/me.js        profile, password, account deletion
   ├─ modules/services.js  catalogue, search, archive
   ├─ modules/staff.js     staff, services offered, weekly hours
   └─ modules/bookings.js  availability (SQL), booking lifecycle
   │
   ▼
lib/pg (pool + wire-protocol client) ──► PostgreSQL 16
                                         constraints, exclusion constraint, indexes
```

## Decisions

### The database owns the invariants

`bookings_no_overlap` is an exclusion constraint over `(staff_id, tstzrange(starts_at, ends_at))` for non-cancelled rows. Application checks give friendly messages; the constraint makes double booking impossible under concurrency. CHECK constraints bound prices, durations (multiples of 5), statuses and text lengths.

### Availability in one SQL statement

Working hours are wall-clock times. For a date, `($date + start_time) AT TIME ZONE $tz` turns each interval into real instants, so a day that changes to or from daylight saving time still produces correct slots. `generate_series` steps through the interval and `NOT EXISTS` removes slots that overlap an active booking. Creating a booking re-checks the same rules server-side; the client's choice is never trusted.

### Short access tokens, rotating refresh tokens

Access tokens live 15 minutes and are kept in memory by the client, never in storage. Refresh tokens are opaque, hashed at rest and rotated on each use. Each login is a token family; replaying a rotated token is treated as theft and revokes the family. The role in the JWT is not trusted for authorization: the user row is loaded per request.

### Rate-limit buckets by purpose

Login and registration share a strict bucket (10/min per IP). Session refresh, which runs on every page load, has its own bucket (60/min); the end-to-end test caught that sharing one bucket locked out users who reloaded a few times.

### Dependencies

The server has zero runtime dependencies: Node's `http`, `crypto` and `net`, plus small in-repo modules for validation, JWT and the PostgreSQL protocol. This keeps the supply chain to the Node runtime and the image tiny. The trade-off is owning that code; it's covered by unit and integration tests, and the database layer sits behind `query(text, params)` and `tx(fn)` so it can be replaced with `pg` without touching handlers.

### Migrations

Numbered SQL files, forward-only, each in a transaction, recorded with a SHA-256 checksum, serialised with an advisory lock so two containers starting together can't both migrate. Destructive changes should ship as a new migration after a backup (see Shipyard).

## Data model

```
users ─┬─< refresh_tokens
       ├── staff_profiles ─┬─< staff_services >── services
       │                   └─< working_hours
       └─< bookings >── services
              └── staff_profiles
```
