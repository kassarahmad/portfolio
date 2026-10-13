# Shipyard runbook

Step-by-step operation of the production stack on one AWS EC2 instance. Nothing here has been run against a real AWS account as part of this portfolio; see "What has been verified" in the README.

## 1. Provision (AWS console or CLI)

| Item | Setting |
| --- | --- |
| AMI | Ubuntu Server 24.04 LTS (x86_64 or arm64; images are built for the runner's architecture, so match it or add `platforms:` to the release workflow) |
| Size | 2 vCPU / 2 GB RAM is enough for this stack. Check current pricing for your region before launching. |
| Storage | gp3, 20 GB, encrypted |
| Security group | inbound 22/tcp **from your IP only**; 80/tcp and 443/tcp+udp from anywhere; nothing else |
| IAM role | optional: `s3:PutObject` on one backup bucket prefix, nothing more |
| Metadata | IMDSv2 required (hop limit 1) |
| Elastic IP | yes, so DNS doesn't change on restart |

Point DNS A records for `DOMAIN` and `MONITOR_DOMAIN` at the Elastic IP before the first start, so Caddy can obtain certificates.

## 2. Bootstrap the host

```bash
scp scripts/bootstrap-ec2.sh ubuntu@<ip>:
ssh ubuntu@<ip> 'sudo DEPLOY_SSH_KEY="$(cat)" ./bootstrap-ec2.sh' < ~/.ssh/deploy_key.pub
```

Creates the `deploy` user, installs Docker from Docker's signed repository, enables unattended upgrades and fail2ban, sets ufw to 22/80/443, disables SSH passwords and root login. Read the script first; it changes the machine.

## 3. Install the stack

```bash
rsync -a --exclude tests ./ deploy@<ip>:/opt/shipyard/
ssh deploy@<ip>
cd /opt/shipyard
cp .env.example .env && nano .env                       # domains, email, REGISTRY, tags
HOSTWATCH_PASSWORD='long passphrase' scripts/make-secrets.sh build-vm
docker compose -f compose.prod.yml up -d postgres hostwatch
scripts/deploy.sh <release-sha>                          # backs up, migrates, starts, health-checks
docker compose -f compose.prod.yml up -d caddy
```

Create the first Slotbook owner:

```bash
docker compose -f compose.prod.yml exec -e SLOTBOOK_OWNER_PASSWORD='…' slotbook-api node scripts/cli.js create-owner you@example.com "Your Name"
```

Install the Hostwatch agent on the host itself (see `projects/hostwatch/agent/hostwatch-agent.service`) with `HOSTWATCH_SERVER=https://<MONITOR_DOMAIN>` and the token from `secrets/hostwatch_agent_tokens`.

Enable nightly backups:

```bash
sudo cp systemd/shipyard-backup.* /etc/systemd/system/
sudo systemctl daemon-reload && sudo systemctl enable --now shipyard-backup.timer
```

## 4. Releasing

1. Merge to `main`; CI must be green.
2. Tag `vX.Y.Z` and push the tag. The Release workflow builds, scans and pushes images tagged with the commit SHA, and publishes a GitHub release.
3. Run the **Deploy** workflow with that SHA. It pauses until a reviewer approves the `production` environment, then runs `deploy.sh` over SSH and smoke-tests the public health endpoint.

`deploy.sh` order: verified backup → pull → migrate → start → wait for health. If the new container isn't healthy within 90 s, it starts the previous tag again and exits non-zero.

## 5. Rolling back

| Situation | Action |
| --- | --- |
| New release misbehaves, data is fine | Deploy workflow with action `rollback`, or `scripts/rollback.sh` on the host. Takes seconds; database untouched. |
| A release corrupted data | `scripts/restore.sh /var/backups/shipyard/<pre-deploy-file>.dump --confirm`. Takes a safety backup first, restores into a scratch database, then swaps. The replaced database is kept as `slotbook_before_restore_*`. |

Migrations follow **expand/contract**: a release may add columns or tables, but removes something only after the previous release no longer uses it. That's what makes code-only rollback safe.

## 6. Backups

- Nightly at 03:17 (±10 min) via systemd timer, plus one before every deploy and every restore.
- Format: `pg_dump --format=custom`, verified with `pg_restore --list`, SHA-256 alongside.
- Kept 14 days locally (`KEEP_DAYS`). Set `BACKUP_S3_URI` in `/opt/shipyard/backup.env` for an encrypted off-site copy using the instance role.
- **Test restores**: at least monthly, restore the latest dump into a scratch database (`restore.sh` does exactly this before swapping) and check row counts.

## 7. Monitoring and logs

- Hostwatch at `https://MONITOR_DOMAIN`: host CPU, memory, disk, Docker service state, with alerts to a webhook.
- Container health: `docker compose -f compose.prod.yml ps` (all services have health checks or restart policies).
- Logs are JSON lines, rotated at 10 MB × 5 per container: `docker compose -f compose.prod.yml logs -f slotbook-api | jq 'select(.status >= 500)'`.
- Every API response has an `X-Request-Id` that appears in the logs.

## 8. Secrets

- Files under `/opt/shipyard/secrets`, mode 600, owned by `deploy`, mounted into containers as Docker secrets. Never in `.env`, never in git, never in logs.
- Rotation: replace the file and restart the service that uses it. Rotating `jwt_secret` signs every Slotbook user out; rotating `postgres_password` also needs `ALTER ROLE slotbook PASSWORD …` first.

## 9. Incident checklist

1. Is the host up? Hostwatch "No data" alert or `ssh` fails → check the EC2 console status checks.
2. Is Caddy serving? `curl -I https://DOMAIN` → certificate or DNS problems show here.
3. Is the API healthy? `docker compose ps`, then logs filtered by request id.
4. Disk full? Hostwatch disk alert → `docker system df`, prune old images, check `/var/backups/shipyard`.
5. Recent deploy? Roll back first, investigate after.
