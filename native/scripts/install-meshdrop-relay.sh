#!/usr/bin/env bash
#
# Install the MeshDrop relay on the VPS droplet as a boot service.
#
# Usage (on the droplet, as root, from the folder holding meshdrop-relay.js):
#   bash install-meshdrop-relay.sh            # install + start on boot
#   bash install-meshdrop-relay.sh --status   # show service + health
#   bash install-meshdrop-relay.sh --uninstall
#
# After install, set the same PORT as "MeshDrop relay port" in the app settings.
#
set -euo pipefail

PORT="${PORT:-8088}"
SRC_JS="$(cd "$(dirname "$0")" && pwd)/meshdrop-relay.js"
INSTALL_JS="/usr/local/lib/meshdrop-relay.js"
SERVICE_FILE="/etc/systemd/system/meshdrop-relay.service"
DATA_DIR="/var/lib/meshdrop"

need_root() { [ "$(id -u)" -eq 0 ] || { echo "!! run as root (sudo)"; exit 1; }; }

open_firewall() {
  # Best-effort: open the relay port on whatever firewall the droplet uses.
  if command -v ufw >/dev/null 2>&1 && ufw status 2>/dev/null | grep -q "Status: active"; then
    ufw allow "${PORT}/tcp" >/dev/null 2>&1 || true
    echo "    ufw: allowed ${PORT}/tcp"
  fi
  if command -v iptables >/dev/null 2>&1; then
    if ! iptables -C INPUT -p tcp --dport "$PORT" -j ACCEPT >/dev/null 2>&1; then
      iptables -I INPUT -p tcp --dport "$PORT" -j ACCEPT || true
      echo "    iptables: accept tcp ${PORT}"
    fi
  fi
  echo "    NOTE: also allow TCP ${PORT} in the DigitalOcean Cloud Firewall (web console)."
}

install_relay() {
  need_root
  command -v node >/dev/null 2>&1 || { echo "!! Node.js not found. Install it: apt-get install -y nodejs"; exit 1; }
  [ -f "$SRC_JS" ] || { echo "!! meshdrop-relay.js not found next to this script"; exit 1; }

  echo "==> Installing MeshDrop relay (port $PORT)"
  install -D -m 0644 "$SRC_JS" "$INSTALL_JS"
  mkdir -p "$DATA_DIR/files"

  cat > "$SERVICE_FILE" <<EOF
[Unit]
Description=MeshDrop relay (mesh file sharing for MeshLink)
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
Environment=PORT=${PORT}
Environment=MESHDROP_DIR=${DATA_DIR}
ExecStart=$(command -v node) ${INSTALL_JS}
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
EOF

  systemctl daemon-reload
  systemctl enable --now meshdrop-relay.service
  open_firewall
  echo "==> Relay running. In the app, set MeshDrop relay port = ${PORT}"
  echo "    Verify:  curl -s http://localhost:${PORT}/health"
}

status_relay() {
  systemctl status meshdrop-relay.service --no-pager || true
  echo
  echo "==> Health:"
  curl -s "http://localhost:${PORT}/health" || echo "(relay not responding on :$PORT)"
  echo
}

uninstall_relay() {
  need_root
  systemctl disable --now meshdrop-relay.service >/dev/null 2>&1 || true
  rm -f "$SERVICE_FILE" "$INSTALL_JS"
  systemctl daemon-reload >/dev/null 2>&1 || true
  echo "==> Removed meshdrop-relay.service. (Data in $DATA_DIR left intact.)"
}

case "${1:-install}" in
  --status) status_relay ;;
  --uninstall) uninstall_relay ;;
  install|"") install_relay ;;
  *) echo "Usage: install-meshdrop-relay.sh [--status|--uninstall]"; exit 1 ;;
esac
