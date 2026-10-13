#!/usr/bin/env bash
# Restore the Slotbook database from a backup. DESTRUCTIVE: it replaces every
# row written since the backup, so it refuses to run without --confirm.
#
# Steps: verify checksum → take a safety backup of the current data → stop the
# API → restore into a scratch database → swap it in → start the API.
# If the scratch restore fails, the live database is untouched.
#
# Usage: scripts/restore.sh <backup-file> --confirm
source "$(dirname "$0")/lib.sh"

file="${1:-}"
[[ -f "$file" ]] || die "usage: restore.sh <backup-file> --confirm"
[[ "${2:-}" == "--confirm" ]] || die "this replaces live data. Re-run with --confirm if you mean it."
lock

if [[ -f "$file.sha256" ]]; then
  sha256sum --check --status "$file.sha256" || die "checksum mismatch: $file is corrupted"
else
  log "WARNING: no checksum file next to $file"
fi

log "safety backup of the current database"
"$(dirname "$0")/backup.sh" pre-restore >/dev/null || die "safety backup failed; nothing changed"

psql() { $COMPOSE exec -T postgres psql -v ON_ERROR_STOP=1 -U slotbook -d postgres "$@"; }

log "restoring into scratch database slotbook_restore"
psql -c "drop database if exists slotbook_restore" -c "create database slotbook_restore owner slotbook"
if ! $COMPOSE exec -T postgres pg_restore -U slotbook -d slotbook_restore --no-owner --exit-on-error < "$file"; then
  psql -c "drop database if exists slotbook_restore"
  die "restore into scratch database failed; live database untouched"
fi

log "stopping the API and swapping databases"
$COMPOSE stop slotbook-api
psql -c "select pg_terminate_backend(pid) from pg_stat_activity where datname = 'slotbook' and pid <> pg_backend_pid()" \
     -c "alter database slotbook rename to slotbook_before_restore_$(date -u +%Y%m%d%H%M%S)" \
     -c "alter database slotbook_restore rename to slotbook"
$COMPOSE start slotbook-api
wait_healthy slotbook-api "${HEALTH_TIMEOUT:-90}" || die "API unhealthy after restore; the previous data is kept as slotbook_before_restore_*"
log "restore complete. The previous database is kept as slotbook_before_restore_*; drop it once you're satisfied."
