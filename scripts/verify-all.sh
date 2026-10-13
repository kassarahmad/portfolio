#!/usr/bin/env bash
# Runs every local check in the repository and prints a summary.
# Needs: Node 22, Python 3, a PostgreSQL role that can create databases
# (PGHOST/PGUSER/PGPASSWORD), and Playwright for the browser tests.
#   PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs  if Playwright isn't installed locally
#   SLOTBOOK_URL=http://localhost:3000               to include Slotbook's browser tests
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
results=()
run() {
  local name="$1"; shift
  local out
  if out="$("$@" 2>&1)"; then
    local n; n="$(grep -Eo '^# pass [0-9]+|^Ran [0-9]+ tests|[0-9]+ passed' <<<"$out" | tail -1)"
    results+=("PASS  $name ${n:+($n)}")
  else
    results+=("FAIL  $name")
    printf '\n--- %s ---\n%s\n' "$name" "$(tail -n 30 <<<"$out")" >&2
  fi
}

cd "$ROOT/site" || exit 1
run "site: build" node scripts/build.mjs
run "site: build tests" npm test --silent
run "site: browser tests" npm run test:e2e --silent
run "site: formatting" prettier --check .

cd "$ROOT/projects/slotbook" || exit 1
run "slotbook: lint" eslint .
run "slotbook: types" tsc -p jsconfig.json
run "slotbook: formatting" prettier --check .
run "slotbook: unit" npm run test:unit --silent
run "slotbook: integration (PostgreSQL)" npm run test:integration --silent
[[ -n "${SLOTBOOK_URL:-}" ]] && run "slotbook: browser" npm run test:e2e --silent

cd "$ROOT/projects/hostwatch/server" || exit 1
run "hostwatch: lint" eslint .
run "hostwatch: types" tsc -p jsconfig.json
run "hostwatch: formatting" prettier --check .
run "hostwatch: server tests" npm test --silent
run "hostwatch: agent tests" python3 -m unittest discover -s ../agent/tests

cd "$ROOT/projects/shipyard" || exit 1
run "shipyard: script syntax" bash -c 'for f in scripts/*.sh tests/*.sh; do bash -n "$f" || exit 1; done'
run "shipyard: script tests" tests/test_scripts.sh
run "shipyard: compose config" bash -c 'tmp=$(mktemp -d); cp -r . "$tmp"; cd "$tmp"; cp .env.example .env; mkdir -p secrets; for s in postgres_password jwt_secret hostwatch_session_secret hostwatch_password_hash hostwatch_agent_tokens; do echo x > secrets/$s; done; docker compose -f compose.prod.yml config --quiet; rc=$?; rm -rf "$tmp"; exit $rc'

cd "$ROOT" || exit 1
run "repo: no secrets or env files tracked" bash -c '! git ls-files | grep -E "(^|/)\.env$|secrets/|\.pem$|id_ed25519|docs/private" && ! git grep -nE "(sk-[A-Za-z0-9]{20,}|BEGIN [A-Z ]*PRIVATE KEY|AKIA[0-9A-Z]{16})" -- . ":!scripts/verify-all.sh" ":!site/tests/*"'

printf '\n'
printf '%s\n' "${results[@]}"
! printf '%s\n' "${results[@]}" | grep -q '^FAIL'
