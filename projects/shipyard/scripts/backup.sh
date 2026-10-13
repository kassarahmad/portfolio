#!/usr/bin/env bash
# Logical backup of the Slotbook database with pg_dump (custom format), then a
# check that the file is a readable archive, then retention.
#
# Usage: scripts/backup.sh [label]
# Env:   BACKUP_DIR (default /var/backups/shipyard), KEEP_DAYS (default 14)
#        BACKUP_S3_URI optional, e.g. s3://my-bucket/shipyard (uses the instance role)
source "$(dirname "$0")/lib.sh"

label="${1:-scheduled}"
[[ "$label" =~ ^[A-Za-z0-9._-]+$ ]] || die "label may only contain letters, digits, . _ -"
umask 077
mkdir -p "$BACKUP_DIR"
file="$BACKUP_DIR/slotbook-$(date -u +%Y%m%dT%H%M%SZ)-$label.dump"

log "dumping database to $file"
if ! $COMPOSE exec -T postgres pg_dump -U slotbook -d slotbook --format=custom --no-owner > "$file.partial"; then
  rm -f "$file.partial"
  die "pg_dump failed"
fi
[[ -s "$file.partial" ]] || { rm -f "$file.partial"; die "backup is empty"; }

# A dump that pg_restore can't list is not a backup.
if ! $COMPOSE exec -T postgres pg_restore --list < "$file.partial" > /dev/null; then
  rm -f "$file.partial"
  die "backup failed verification"
fi
mv "$file.partial" "$file"
sha256sum "$file" > "$file.sha256"
log "backup ok: $(du -h "$file" | cut -f1)"

if [[ -n "${BACKUP_S3_URI:-}" ]]; then
  aws s3 cp --only-show-errors --sse AES256 "$file" "$BACKUP_S3_URI/" && aws s3 cp --only-show-errors "$file.sha256" "$BACKUP_S3_URI/" \
    || log "WARNING: off-site copy failed; the local backup is still valid"
fi

find "$BACKUP_DIR" -name 'slotbook-*.dump*' -type f -mtime +"${KEEP_DAYS:-14}" -print -delete | sed 's/^/pruned /' >&2 || true
printf '%s\n' "$file"
