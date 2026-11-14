#!/usr/bin/env bash
# Sets up the Pulse server on a fresh Ubuntu VM (made for Oracle Cloud's free tier).
# Run from the folder that holds index.mjs:   sudo bash install.sh
# Safe to run again (for example after copying a newer index.mjs).
set -euo pipefail

if [ "$(id -u)" -ne 0 ]; then echo "Run it with sudo: sudo bash install.sh"; exit 1; fi
HERE="$(cd "$(dirname "$0")" && pwd)"

echo "== Node.js 22"
if ! command -v node >/dev/null || [ "$(node -p 'process.versions.node.split(".")[0]')" -lt 20 ]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi

echo "== Pulse server files"
id pulse >/dev/null 2>&1 || useradd --system --home /var/lib/pulse --shell /usr/sbin/nologin pulse
mkdir -p /opt/pulse /var/lib/pulse
cp "$HERE/index.mjs" /opt/pulse/index.mjs
chown -R pulse:pulse /var/lib/pulse

cat >/etc/systemd/system/pulse-server.service <<'UNIT'
[Unit]
Description=Pulse Music profiles server
After=network-online.target
Wants=network-online.target

[Service]
User=pulse
Environment=PORT=8787
Environment=DATA_DIR=/var/lib/pulse
ExecStart=/usr/bin/node /opt/pulse/index.mjs
Restart=always
RestartSec=3
NoNewPrivileges=true
ProtectSystem=strict
ReadWritePaths=/var/lib/pulse
ProtectHome=true
PrivateTmp=true

[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload
systemctl enable --now pulse-server
systemctl restart pulse-server

echo "== Firewall (Oracle's Ubuntu images block everything but SSH)"
for p in 80 443; do
  if ! iptables -C INPUT -p tcp --dport $p -j ACCEPT 2>/dev/null; then
    # before the image's catch-all REJECT rule, if there is one
    n="$(iptables -L INPUT --line-numbers -n | awk '$2=="REJECT"{print $1; exit}')"
    if [ -n "$n" ]; then iptables -I INPUT "$n" -p tcp --dport $p -j ACCEPT; else iptables -A INPUT -p tcp --dport $p -j ACCEPT; fi
  fi
done
if command -v netfilter-persistent >/dev/null; then netfilter-persistent save; fi

echo "== HTTPS with Caddy"
if ! command -v caddy >/dev/null; then
  apt-get install -y debian-keyring debian-archive-keyring apt-transport-https curl gnupg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor --yes -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' >/etc/apt/sources.list.d/caddy-stable.list
  apt-get update
  apt-get install -y caddy
fi
# A free name that points at this machine's address, so Caddy can get a certificate.
DOMAIN="${PULSE_DOMAIN:-}"
if [ -z "$DOMAIN" ]; then
  IP="$(curl -fsS https://api.ipify.org)"
  DOMAIN="${IP//./-}.sslip.io"
fi
cat >/etc/caddy/Caddyfile <<CADDY
$DOMAIN {
  encode gzip
  request_body {
    max_size 5MB
  }
  reverse_proxy 127.0.0.1:8787
}
CADDY
systemctl enable caddy >/dev/null
systemctl reload caddy || systemctl restart caddy

echo "== Checking"
sleep 4
if curl -fsS "https://$DOMAIN/v1/health"; then
  echo
  echo "Done. Put this line into .env.local in the pulsemusic project and build again:"
  echo "MAIN_VITE_PULSE_SERVER=https://$DOMAIN"
else
  echo
  echo "The server runs, but https://$DOMAIN isn't reachable yet."
  echo "Check that ports 80 and 443 are open in Oracle Cloud (see README.md, step 2), then run this again."
fi
