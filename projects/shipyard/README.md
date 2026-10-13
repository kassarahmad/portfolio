# Shipyard

How Slotbook and Hostwatch get to production: a single Linux server (AWS EC2) running Docker Compose behind Caddy with automatic HTTPS, with backups, health-checked deploys, one-command rollback, and a CI/CD pipeline that scans what it ships and waits for a human before touching production.

**Status:** portfolio project. Configuration, scripts and pipelines are complete and validated locally (see below). It has **not** been deployed to a real AWS account, and no cloud resources were created.

```
                         ┌──────────────────────── EC2 (Ubuntu 24.04) ────────────────────────┐
 GitHub Actions          │                                                                    │
 CI ─► Release ─► Deploy ─ssh─► deploy.sh   ufw + security group: 22 (your IP), 80, 443       │
 (tests, scans)  (images,  │    │                                                               │
                  SBOM)    │    ▼                          edge network          internal network│
 ghcr.io ◄──────────────── │  Caddy :80/:443 ──► slotbook-api (read-only) ──► postgres          │
                           │   auto-TLS     └──► hostwatch    (read-only)     no ports, no egress│
                           │                                                                    │
                           │  systemd: hostwatch-agent (/proc) · shipyard-backup.timer ──► S3   │
                           └────────────────────────────────────────────────────────────────────┘
```

## What's in here

| Path | Purpose |
| --- | --- |
| `compose.prod.yml` | Caddy, Slotbook API, PostgreSQL, Hostwatch. Only Caddy publishes ports; Postgres is on an internal network with no Internet route. Read-only root filesystems, all capabilities dropped, `no-new-privileges`, memory limits, log rotation, health checks. |
| `Caddyfile` | HTTPS via Let's Encrypt for both domains, HSTS, compression, JSON access logs, SSE pass-through. |
| `scripts/deploy.sh` | Verified backup → pull → migrate → start → health check → automatic rollback on failure. Locked so two operations can't overlap. |
| `scripts/rollback.sh` | Starts the previously deployed image again (code only). |
| `scripts/backup.sh` / `restore.sh` | `pg_dump` with verification, checksum, retention and optional S3 copy; restore into a scratch database first, keep the old one. Restore refuses to run without `--confirm`. |
| `scripts/make-secrets.sh` | Random secrets as files (mode 600); never overwrites existing ones. |
| `scripts/bootstrap-ec2.sh` | Hardens a fresh Ubuntu host and installs Docker from the official repository. |
| `systemd/` | Nightly backup timer. |
| `../../.github/workflows/` | `ci.yml`, `release.yml`, `deploy.yml` |
| `docs/RUNBOOK.md` | Provisioning, first install, releases, rollback, backups, secrets, incidents. |

## Pipeline

1. **CI** (every push and PR): lint, format and type checks; unit, integration (real PostgreSQL service) and browser tests for both apps; ShellCheck and the script tests; Compose and Caddyfile validation; workflow linting (actionlint); secret scanning (gitleaks); image builds scanned with Trivy, failing on fixable HIGH/CRITICAL vulnerabilities and on Dockerfile misconfigurations.
2. **Release** (on a `v*.*.*` tag): builds once, pushes to GHCR tagged by commit SHA and version, with SBOM and signed build provenance; scans the pushed images; publishes a GitHub release with the image digests and the deployment bundle.
3. **Deploy** (manual): the `production` environment requires an approving reviewer before the job can read SSH secrets. The host key is pinned. The job runs `deploy.sh` and then checks the public health endpoint. A `rollback` action runs `rollback.sh`.

## Tests

```bash
tests/test_scripts.sh
```

19 checks run `deploy.sh`, `rollback.sh`, `backup.sh` and `restore.sh` against a fake `docker` that can make the pull, migration, backup or health check fail. They cover: backup taken before deploy, migrations before start, automatic rollback of an unhealthy release, failed migration or pull leaving the running release untouched, failed backup aborting before any change, rollback and roll-forward, rejection of path-like or shell-metacharacter tags, restore refusing without `--confirm` or with a bad checksum, and the operation lock.

## What has been verified, and what hasn't

| Verified locally | Not verified (needs a real environment) |
| --- | --- |
| `docker compose config` resolves the production file; only Caddy publishes ports; Postgres only on the internal network | Containers actually running together on a Docker daemon (none was available in the build environment) |
| All script logic through the fake-docker tests; `bash -n` on every script | ShellCheck, actionlint and the Caddyfile validation run in CI, not locally |
| YAML of all workflows parses | The workflows themselves running on GitHub Actions |
| Both app images' Dockerfiles follow the same pattern as their tested local runs | Let's Encrypt issuance, EC2 provisioning, S3 upload |

## Why not Terraform here

The provisioning is a single instance, a security group and an Elastic IP, documented in the runbook. Terraform would be the right next step for repeatability, but it should be written and validated with `terraform plan` against a real account; untested infrastructure code would claim more than this project can show. It's first on the roadmap.

## Known limitations

- Single host: no high availability; a host failure means restoring from backup onto a new instance (RTO is the time to run the runbook; RPO is up to 24 hours unless backups run more often).
- Rollback is code-only by design; data rollback is a deliberate, manual restore.
- Docker publishes ports through its own iptables rules, bypassing ufw. Only Caddy publishes ports, and the security group is the outer boundary.
- No centralised log storage; logs live in rotated files on the host.

## Roadmap

1. Terraform for the instance, security group, Elastic IP, S3 bucket with lifecycle rules and the IAM role, validated with `plan` in CI.
2. Point-in-time recovery with WAL archiving (e.g. `pgBackRest`) to shrink RPO.
3. Ship logs to a managed store (CloudWatch Logs) with alerts on 5xx rate.
4. Blue/green API containers behind Caddy for zero-downtime deploys.
