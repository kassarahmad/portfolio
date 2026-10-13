#!/usr/bin/env bash
# Deploy a Slotbook image tag:
#   1. back up the database (deploy aborts if the backup fails)
#   2. pull the new image
#   3. run migrations with the new image
#   4. replace the API container and wait for its health check
#   5. on failure, put the previous tag back automatically
#
# Usage: scripts/deploy.sh <image-tag>
source "$(dirname "$0")/lib.sh"

tag="${1:-}"
valid_tag "$tag" || die "usage: deploy.sh <image-tag>   (got '${tag}')"
lock

current="$(state_get current)"
if [[ "$tag" == "$current" ]]; then
  log "tag $tag is already deployed; nothing to do"
  exit 0
fi

log "backing up the database before deploying $tag"
"$(dirname "$0")/backup.sh" "pre-deploy-$tag" || die "backup failed; deploy aborted with nothing changed"

env_set SLOTBOOK_TAG "$tag"
log "pulling image $tag"
if ! $COMPOSE pull slotbook-api; then
  [[ -n "$current" ]] && env_set SLOTBOOK_TAG "$current"
  die "pull failed; still running ${current:-nothing}"
fi

log "running migrations"
if ! $COMPOSE run --rm --no-deps slotbook-api node scripts/cli.js migrate; then
  [[ -n "$current" ]] && env_set SLOTBOOK_TAG "$current"
  die "migration failed (each migration is transactional, so nothing was half-applied); still running ${current:-nothing}"
fi

log "starting $tag"
$COMPOSE up -d --no-deps slotbook-api

if wait_healthy slotbook-api "${HEALTH_TIMEOUT:-90}"; then
  [[ -n "$current" ]] && state_set previous "$current"
  state_set current "$tag"
  printf '%s %s\n' "$(date -u +%FT%TZ)" "$tag" >> "$STATE_DIR/history"
  log "deployed $tag (previous: ${current:-none})"
  docker image prune -f --filter "until=168h" >/dev/null 2>&1 || true
  exit 0
fi

log "$tag did not become healthy"
$COMPOSE logs --tail=50 slotbook-api >&2 || true
if [[ -n "$current" ]]; then
  log "rolling back to $current"
  env_set SLOTBOOK_TAG "$current"
  $COMPOSE up -d --no-deps slotbook-api
  wait_healthy slotbook-api "${HEALTH_TIMEOUT:-90}" || die "rollback to $current is also unhealthy: page a human"
  log "rolled back to $current"
fi
exit 1
