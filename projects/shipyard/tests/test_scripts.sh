#!/usr/bin/env bash
# Exercises deploy.sh, rollback.sh, backup.sh and restore.sh against a fake
# docker CLI. The fake records every call and simulates outcomes:
#   FAKE_UNHEALTHY_TAGS  tags whose container never becomes healthy
#   FAKE_FAIL            pull | migrate | dump : make that step fail
# Run: tests/test_scripts.sh
set -Euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
pass=0; fail=0
ok()  { pass=$((pass+1)); printf '  ok   %s\n' "$1"; }
bad() { fail=$((fail+1)); printf '  FAIL %s\n' "$1"; }
check() { if eval "$2"; then ok "$1"; else bad "$1"; fi; }

setup() {
  T="$(mktemp -d)"
  mkdir -p "$T/bin" "$T/backups"
  printf 'REGISTRY=example\nSLOTBOOK_TAG=none\nHOSTWATCH_TAG=x\n' > "$T/.env"
  cat > "$T/bin/fake-compose" <<'EOF'
#!/usr/bin/env bash
echo "compose $*" >> "$FAKE_LOG"
tag="$(sed -n 's/^SLOTBOOK_TAG=//p' "$SHIPYARD_DIR/.env")"
case "$1" in
  pull) [[ "${FAKE_FAIL:-}" == pull ]] && exit 1; exit 0 ;;
  run) [[ "${FAKE_FAIL:-}" == migrate ]] && exit 1; exit 0 ;;
  up) echo "$tag" > "$FAKE_RUNNING"; exit 0 ;;
  ps) echo "cid123" ;;
  exec)
    if [[ "$*" == *pg_dump* ]]; then [[ "${FAKE_FAIL:-}" == dump ]] && exit 1; printf 'PGDMP-fake-archive'; fi
    if [[ "$*" == *"pg_restore --list"* ]]; then cat >/dev/null; fi
    exit 0 ;;
  *) exit 0 ;;
esac
EOF
  cat > "$T/bin/docker" <<'EOF'
#!/usr/bin/env bash
echo "docker $*" >> "$FAKE_LOG"
if [[ "$1" == inspect ]]; then
  running="$(cat "$FAKE_RUNNING" 2>/dev/null)"
  for t in ${FAKE_UNHEALTHY_TAGS:-}; do [[ "$t" == "$running" ]] && { echo unhealthy; exit 0; }; done
  echo healthy
fi
exit 0
EOF
  chmod +x "$T/bin/"*
  export PATH="$T/bin:$PATH" SHIPYARD_DIR="$T" STATE_DIR="$T/.deploy" BACKUP_DIR="$T/backups" \
         COMPOSE="$T/bin/fake-compose" FAKE_LOG="$T/calls.log" FAKE_RUNNING="$T/running" HEALTH_TIMEOUT=6
  unset FAKE_FAIL FAKE_UNHEALTHY_TAGS
}
deploy()   { "$ROOT/scripts/deploy.sh" "$@" >/dev/null 2>"$T/err"; }
rollback() { "$ROOT/scripts/rollback.sh" >/dev/null 2>"$T/err"; }
envtag()   { sed -n 's/^SLOTBOOK_TAG=//p' "$T/.env"; }
state()    { cat "$T/.deploy/$1" 2>/dev/null; }

echo "deploy and rollback"
setup
deploy v1; check "first deploy succeeds" '[[ $? -eq 0 ]]'
check "first deploy records current" '[[ "$(state current)" == v1 ]]'
check "a verified backup was taken before deploying" 'ls "$T"/backups/*pre-deploy-v1.dump >/dev/null 2>&1 && ls "$T"/backups/*pre-deploy-v1.dump.sha256 >/dev/null'
check "migrations ran before the new container started" 'grep -n "compose run" "$T/calls.log" | head -1 | cut -d: -f1 | { read r; u=$(grep -n "compose up" "$T/calls.log" | head -1 | cut -d: -f1); (( r < u )); }'
deploy v2
check "second deploy: current v2, previous v1" '[[ "$(state current)" == v2 && "$(state previous)" == v1 ]]'
deploy v2; check "redeploying the same tag is a no-op" '[[ $? -eq 0 && $(grep -c "pre-deploy-v2" <(ls "$T/backups")) -eq 2 ]]'

export FAKE_UNHEALTHY_TAGS=v3
deploy v3; rc=$?
check "unhealthy release fails the deploy" '[[ $rc -ne 0 ]]'
check "and is rolled back automatically to v2" '[[ "$(envtag)" == v2 && "$(cat "$T/running")" == v2 && "$(state current)" == v2 ]]'
unset FAKE_UNHEALTHY_TAGS

export FAKE_FAIL=migrate
deploy v4; rc=$?
check "failed migration stops the deploy" '[[ $rc -ne 0 ]]'
check "and v4 never starts" '[[ "$(cat "$T/running")" == v2 && "$(envtag)" == v2 ]]'
export FAKE_FAIL=pull
deploy v5; check "failed pull leaves the running release alone" '[[ $? -ne 0 && "$(envtag)" == v2 ]]'
export FAKE_FAIL=dump
: > "$T/calls.log"
deploy v6; check "failed backup aborts before anything changes" '[[ $? -ne 0 && "$(envtag)" == v2 ]] && ! grep -qE "compose (pull|run|up)" "$T/calls.log"'
unset FAKE_FAIL

rollback; check "rollback returns to the previous release" '[[ $? -eq 0 && "$(state current)" == v1 && "$(state previous)" == v2 && "$(cat "$T/running")" == v1 ]]'
rollback; check "rolling back twice returns to where we started" '[[ "$(state current)" == v2 ]]'

echo "input validation and guards"
deploy '../etc'; check "path-like tags are rejected" '[[ $? -ne 0 ]] && grep -q usage "$T/err"'
deploy 'v1;rm -rf /'; check "shell metacharacters are rejected" '[[ $? -ne 0 ]]'
f="$(ls "$T"/backups/*.dump | head -1)"
"$ROOT/scripts/restore.sh" "$f" >/dev/null 2>"$T/err"; check "restore refuses without --confirm" '[[ $? -ne 0 ]] && grep -q -- "--confirm" "$T/err"'
echo tampered >> "$f"
"$ROOT/scripts/restore.sh" "$f" --confirm >/dev/null 2>"$T/err"; check "restore refuses a backup whose checksum doesn't match" '[[ $? -ne 0 ]] && grep -q checksum "$T/err"'
exec 9> "$T/.deploy/lock"; flock -n 9
deploy v9; check "a second operation can't run while one holds the lock" '[[ $? -ne 0 ]] && grep -q "another deploy" "$T/err"'
exec 9>&-

rm -rf "$T"
printf '\n%d passed, %d failed\n' "$pass" "$fail"
(( fail == 0 ))
