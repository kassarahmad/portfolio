#!/usr/bin/env bash
# Shared helpers for the operational scripts. Source, don't execute.
set -Eeuo pipefail

SHIPYARD_DIR="${SHIPYARD_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
STATE_DIR="${STATE_DIR:-$SHIPYARD_DIR/.deploy}"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/shipyard}"
# Overridable so tests can substitute a fake docker.
COMPOSE="${COMPOSE:-docker compose --project-directory $SHIPYARD_DIR -f $SHIPYARD_DIR/compose.prod.yml}"

log() { printf '%s %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*" >&2; }
die() { log "ERROR: $*"; exit 1; }

valid_tag() { [[ "$1" =~ ^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$ ]]; }

state_get() { [[ -f "$STATE_DIR/$1" ]] && cat "$STATE_DIR/$1" || true; }
state_set() { mkdir -p "$STATE_DIR"; printf '%s\n' "$2" > "$STATE_DIR/$1.tmp" && mv "$STATE_DIR/$1.tmp" "$STATE_DIR/$1"; }

# Replace KEY=value in .env atomically (keeps the file's other lines).
env_set() {
  local key="$1" value="$2" file="$SHIPYARD_DIR/.env"
  [[ -f "$file" ]] || die "$file not found; copy .env.example first"
  awk -v k="$key" -v v="$value" 'BEGIN{done=0} $0 ~ "^"k"=" {print k"="v; done=1; next} {print} END{if(!done) print k"="v}' "$file" > "$file.tmp"
  mv "$file.tmp" "$file"
}

# Waits until the API container reports healthy (Docker HEALTHCHECK) or times out.
wait_healthy() {
  local service="$1" timeout="${2:-90}" waited=0 id status
  while (( waited < timeout )); do
    id="$($COMPOSE ps -q "$service" 2>/dev/null || true)"
    if [[ -n "$id" ]]; then
      status="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$id" 2>/dev/null || echo unknown)"
      [[ "$status" == "healthy" ]] && return 0
      [[ "$status" == "unhealthy" || "$status" == "exited" ]] && return 1
    fi
    sleep 3; waited=$(( waited + 3 ))
  done
  return 1
}

lock() {
  mkdir -p "$STATE_DIR"
  exec 9> "$STATE_DIR/lock"
  flock -n 9 || die "another deploy, rollback or restore is running"
}
