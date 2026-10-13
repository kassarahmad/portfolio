#!/usr/bin/env bash
# Creates ./secrets with random values (mode 600). Existing files are kept, so
# re-running never rotates a secret by accident.
#
# Usage: HOSTWATCH_PASSWORD='dashboard passphrase' scripts/make-secrets.sh host1 [host2 ...]
#   host names are the machines whose agents will report to Hostwatch.
set -Eeuo pipefail
dir="$(cd "$(dirname "$0")/.." && pwd)/secrets"
umask 077
mkdir -p "$dir"

rand() { openssl rand -base64 48 | tr -d '\n/+=' | cut -c1-48; }
put() {
  if [[ -s "$dir/$1" ]]; then echo "keep   $1"; else printf '%s' "$2" > "$dir/$1"; echo "create $1"; fi
}

put postgres_password "$(rand)"
put jwt_secret "$(rand)"
put hostwatch_session_secret "$(rand)"

if [[ ! -s "$dir/hostwatch_password_hash" ]]; then
  [[ -n "${HOSTWATCH_PASSWORD:-}" ]] || { echo "Set HOSTWATCH_PASSWORD (12+ characters) for the dashboard." >&2; exit 2; }
  hash="$(docker run --rm -e HOSTWATCH_PASSWORD "${REGISTRY:-ghcr.io/your-user}/hostwatch:${HOSTWATCH_TAG:-latest}" node src/cli.js hash-password)"
  put hostwatch_password_hash "$hash"
fi

if [[ ! -s "$dir/hostwatch_agent_tokens" ]]; then
  (( $# > 0 )) || { echo "Pass at least one host name for agent tokens." >&2; exit 2; }
  pairs=()
  for h in "$@"; do pairs+=("$h=$(rand)"); done
  put hostwatch_agent_tokens "$(IFS=,; echo "${pairs[*]}")"
  echo "Agent tokens are in $dir/hostwatch_agent_tokens; copy each host's token into its /etc/hostwatch-agent.env."
fi
chmod 600 "$dir"/*
