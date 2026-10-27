#!/usr/bin/env bash
# Runs on the Ubuntu server (called by deploy.ps1). Idempotent: safe to re-run on every deploy.
set -euo pipefail
DIR="${1:-/opt/papi}"

# Small free VMs (e.g. VM.Standard.E2.1.Micro, 1 GB RAM) need swap to build the Next.js image.
if [ ! -f /swapfile ] && [ "$(awk '/MemTotal/ {print $2}' /proc/meminfo)" -lt 4000000 ]; then
  echo "==> Adding 4 GB swap"
  fallocate -l 4G /swapfile && chmod 600 /swapfile && mkswap /swapfile >/dev/null && swapon /swapfile
  grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

if ! command -v docker >/dev/null 2>&1; then
  echo "==> Installing Docker"
  curl -fsSL https://get.docker.com | sh
fi
systemctl enable --now docker >/dev/null 2>&1 || true

# Oracle's Ubuntu images ship iptables rules that reject everything except SSH.
for port in 80 443; do
  if ! iptables -C INPUT -p tcp --dport "$port" -j ACCEPT 2>/dev/null; then
    echo "==> Opening port $port"
    iptables -I INPUT -p tcp --dport "$port" -j ACCEPT
  fi
done
if command -v netfilter-persistent >/dev/null 2>&1; then netfilter-persistent save >/dev/null 2>&1 || true; fi

echo "==> Unpacking app into $DIR"
mkdir -p "$DIR"
tar -xzf /tmp/app.tgz -C "$DIR"
install -m 600 /tmp/app.env "$DIR/.env"
rm -f /tmp/app.tgz /tmp/app.env

cd "$DIR"
echo "==> Building and starting containers (first build takes a few minutes)"
docker compose --profile tls up -d --build --remove-orphans
docker image prune -f >/dev/null 2>&1 || true
docker compose --profile tls ps

if ! docker compose run --rm --no-deps --entrypoint sh worker -c 'test -s /data/steam-refresh-token.txt' >/dev/null 2>&1; then
  echo
  echo "!! The bot is not logged in to Steam yet. Run deploy.ps1 with -SteamLogin once."
fi
