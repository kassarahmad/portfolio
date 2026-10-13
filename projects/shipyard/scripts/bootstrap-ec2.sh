#!/usr/bin/env bash
# One-time setup of a fresh Ubuntu 24.04 EC2 instance. Run as root (sudo).
# Idempotent: safe to run again. Review before running; it changes the host:
#   - creates a 'deploy' user that can run docker (no password, SSH keys only)
#   - installs Docker Engine + Compose plugin from Docker's apt repository
#   - enables unattended security upgrades
#   - firewall: allows SSH (22), HTTP (80), HTTPS (443 tcp+udp); denies the rest
#   - hardens sshd: no passwords, no root login
#   - creates /opt/shipyard and /var/backups/shipyard
#
# Usage: sudo DEPLOY_SSH_KEY="ssh-ed25519 AAAA... ci@github" ./bootstrap-ec2.sh
set -Eeuo pipefail
[[ $EUID -eq 0 ]] || { echo "run with sudo" >&2; exit 1; }
. /etc/os-release
[[ "$ID" == "ubuntu" ]] || { echo "written for Ubuntu; found $ID" >&2; exit 1; }

export DEBIAN_FRONTEND=noninteractive
apt-get update -q
apt-get install -yq ca-certificates curl gnupg ufw unattended-upgrades fail2ban awscli

# Docker from the official repository (signed)
install -m 0755 -d /etc/apt/keyrings
if [[ ! -f /etc/apt/keyrings/docker.asc ]]; then
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
  chmod a+r /etc/apt/keyrings/docker.asc
fi
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu ${VERSION_CODENAME} stable" \
  > /etc/apt/sources.list.d/docker.list
apt-get update -q
apt-get install -yq docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

# Docker daemon: rotate logs, no inter-container traffic on the default bridge
cat > /etc/docker/daemon.json <<'JSON'
{
  "log-driver": "json-file",
  "log-opts": { "max-size": "10m", "max-file": "5" },
  "icc": false,
  "live-restore": true,
  "no-new-privileges": true
}
JSON
systemctl enable --now docker
systemctl restart docker

# Deploy user
id deploy >/dev/null 2>&1 || useradd --create-home --shell /bin/bash deploy
usermod -aG docker deploy
install -d -m 700 -o deploy -g deploy /home/deploy/.ssh
if [[ -n "${DEPLOY_SSH_KEY:-}" ]] && ! grep -qF "$DEPLOY_SSH_KEY" /home/deploy/.ssh/authorized_keys 2>/dev/null; then
  echo "$DEPLOY_SSH_KEY" >> /home/deploy/.ssh/authorized_keys
fi
[[ -f /home/deploy/.ssh/authorized_keys ]] && chown deploy:deploy /home/deploy/.ssh/authorized_keys && chmod 600 /home/deploy/.ssh/authorized_keys

install -d -m 750 -o deploy -g deploy /opt/shipyard
install -d -m 700 -o deploy -g deploy /var/backups/shipyard

# SSH: keys only
cat > /etc/ssh/sshd_config.d/10-hardening.conf <<'SSH'
PasswordAuthentication no
KbdInteractiveAuthentication no
PermitRootLogin no
MaxAuthTries 3
SSH
sshd -t && systemctl reload ssh

# Host firewall (the EC2 security group should match: 22 from your IP only, 80/443 from anywhere)
ufw default deny incoming
ufw default allow outgoing
ufw allow 22/tcp
ufw allow 80/tcp
ufw allow 443/tcp
ufw allow 443/udp
ufw --force enable

# Automatic security updates
dpkg-reconfigure -f noninteractive unattended-upgrades
systemctl enable --now fail2ban

echo "Done. Next: copy the shipyard folder to /opt/shipyard as 'deploy', then follow docs/RUNBOOK.md."
echo "Note: Docker publishes container ports through its own iptables chains, bypassing ufw;"
echo "that's why only Caddy publishes ports in compose.prod.yml."
