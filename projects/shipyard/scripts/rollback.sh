#!/usr/bin/env bash
# Put the previously deployed image back. Code only: the database is not
# touched, which is safe because migrations follow expand/contract (a new
# release never removes something the previous release still uses).
# To also roll back data, use restore.sh with the pre-deploy backup.
#
# Usage: scripts/rollback.sh
source "$(dirname "$0")/lib.sh"
lock

previous="$(state_get previous)"
current="$(state_get current)"
[[ -n "$previous" ]] || die "no previous release recorded in $STATE_DIR"

log "rolling back from ${current:-unknown} to $previous"
env_set SLOTBOOK_TAG "$previous"
$COMPOSE up -d --no-deps slotbook-api
wait_healthy slotbook-api "${HEALTH_TIMEOUT:-90}" || die "$previous is not healthy either; check logs: docker compose logs slotbook-api"

state_set current "$previous"
state_set previous "$current"
printf '%s %s (rollback)\n' "$(date -u +%FT%TZ)" "$previous" >> "$STATE_DIR/history"
log "now running $previous; run rollback.sh again to return to $current"
