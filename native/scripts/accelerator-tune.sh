#!/usr/bin/env bash
#
# MeshLink "Accelerator" — server-side tuning for the glorytun bonding droplet.
#
# This is the real equivalent of Proton VPN's "VPN Accelerator": it doesn't add
# magic, it removes the three classic bottlenecks on a UDP tunnel that carries
# lossy cellular links:
#
#   1. BBR congestion control + fq queueing   -> big throughput gain on loss
#   2. Larger UDP socket buffers              -> glorytun stops dropping bursts
#   3. TCP MSS clamping to the tunnel MTU     -> kills fragmentation stalls
#
# Safe + idempotent: re-running it just re-asserts the same values. All changes
# are written to /etc/sysctl.d so they survive reboots.
#
# Usage (on the droplet, as root):
#   bash accelerator-tune.sh            # apply once, now
#   bash accelerator-tune.sh --install  # apply now AND on every boot (systemd)
#   bash accelerator-tune.sh --status   # show current values, change nothing
#   bash accelerator-tune.sh --revert   # remove tuning (and the boot service)
#
# Run --install ONCE. After that the accelerator re-applies automatically every
# time the droplet reboots or glorytun restarts, so you never have to remember.
#
set -euo pipefail

SYSCTL_FILE="/etc/sysctl.d/99-meshlink-accelerator.conf"
SERVICE_FILE="/etc/systemd/system/meshlink-accelerator.service"
SELF_PATH="/usr/local/sbin/meshlink-accelerator.sh"
TUN_MTU="${TUN_MTU:-1400}"          # must match the glorytun tun MTU
GT_PORT="${GT_PORT:-5000}"          # glorytun UDP port (matches the app default)

need_root() {
  if [ "$(id -u)" -ne 0 ]; then
    echo "!! Please run as root (sudo bash accelerator-tune.sh)"; exit 1
  fi
}

show_status() {
  echo "==> Current network tuning"
  echo "    congestion control : $(sysctl -n net.ipv4.tcp_congestion_control 2>/dev/null || echo '?')"
  echo "    default qdisc      : $(sysctl -n net.core.default_qdisc 2>/dev/null || echo '?')"
  echo "    rmem_max           : $(sysctl -n net.core.rmem_max 2>/dev/null || echo '?')"
  echo "    wmem_max           : $(sysctl -n net.core.wmem_max 2>/dev/null || echo '?')"
  echo "    BBR available      : $(grep -qw bbr /proc/sys/net/ipv4/tcp_available_congestion_control 2>/dev/null && echo yes || echo no)"
  echo "    meshlink sysctl    : $( [ -f "$SYSCTL_FILE" ] && echo "present ($SYSCTL_FILE)" || echo 'not installed' )"
}

revert() {
  need_root
  # Tear down the boot service first, if present.
  if [ -f "$SERVICE_FILE" ]; then
    systemctl disable --now meshlink-accelerator.service >/dev/null 2>&1 || true
    rm -f "$SERVICE_FILE" "$SELF_PATH"
    systemctl daemon-reload >/dev/null 2>&1 || true
    echo "==> Removed boot service meshlink-accelerator.service"
  fi
  rm -f "$SYSCTL_FILE"
  sysctl --system >/dev/null 2>&1 || true
  echo "==> Removed $SYSCTL_FILE and reloaded sysctl. (qdisc/cc revert on reboot.)"
}

install_service() {
  need_root
  # Apply immediately so it's live right now...
  apply
  # ...then persist a copy of this script and a systemd unit that re-runs it on
  # every boot (After=network + glorytun so tun0 exists when we clamp MSS).
  echo
  echo "==> Installing boot service so the accelerator re-applies automatically"
  cp -f "$0" "$SELF_PATH"
  chmod +x "$SELF_PATH"
  cat > "$SERVICE_FILE" <<EOF
[Unit]
Description=MeshLink Accelerator (network tuning for glorytun bond)
After=network-online.target glorytun.service
Wants=network-online.target

[Service]
Type=oneshot
# Re-assert sysctl + MSS clamp. Idempotent, so safe to run every boot.
ExecStart=/usr/bin/env TUN_MTU=${TUN_MTU} GT_PORT=${GT_PORT} bash ${SELF_PATH} apply
RemainAfterExit=yes

[Install]
WantedBy=multi-user.target
EOF
  systemctl daemon-reload
  systemctl enable meshlink-accelerator.service >/dev/null 2>&1 || true
  echo "    enabled meshlink-accelerator.service (runs on every boot)"
  echo "    check anytime with: systemctl status meshlink-accelerator"
}

apply() {
  need_root

  echo "==> Checking BBR availability"
  if ! grep -qw bbr /proc/sys/net/ipv4/tcp_available_congestion_control 2>/dev/null; then
    # Try to load the module (present on all modern DO kernels).
    modprobe tcp_bbr 2>/dev/null || true
  fi
  if grep -qw bbr /proc/sys/net/ipv4/tcp_available_congestion_control 2>/dev/null; then
    CC="bbr"
    echo "    BBR available — using it"
  else
    CC="cubic"
    echo "    !! BBR not available on this kernel — falling back to cubic (buffers still help)"
  fi

  echo "==> Writing $SYSCTL_FILE"
  cat > "$SYSCTL_FILE" <<EOF
# MeshLink Accelerator — managed file, safe to delete to revert.
# Congestion control + fair queueing (the core of the "accelerator").
net.core.default_qdisc = fq
net.ipv4.tcp_congestion_control = ${CC}

# Larger socket buffers so the UDP tunnel absorbs bursts from two bonded radios
# without dropping (16 MB ceilings; autotuning picks within these).
net.core.rmem_max = 16777216
net.core.wmem_max = 16777216
net.core.rmem_default = 1048576
net.core.wmem_default = 1048576
net.ipv4.udp_mem = 65536 131072 262144
net.core.netdev_max_backlog = 5000

# Let the tunnel forward traffic efficiently.
net.ipv4.tcp_mtu_probing = 1
net.ipv4.tcp_fastopen = 3
EOF

  echo "==> Applying sysctl"
  sysctl --system >/dev/null

  echo "==> MSS clamping on the tunnel (so TCP fits the ${TUN_MTU}-byte tun MTU)"
  # Clamp forwarded TCP to the path MTU. Add the rule only if not already there.
  local clamp_mss=$(( TUN_MTU - 40 ))
  if command -v iptables >/dev/null 2>&1; then
    if ! iptables -t mangle -C FORWARD -o tun0 -p tcp --tcp-flags SYN,RST SYN \
         -j TCPMSS --set-mss "$clamp_mss" 2>/dev/null; then
      iptables -t mangle -A FORWARD -o tun0 -p tcp --tcp-flags SYN,RST SYN \
        -j TCPMSS --set-mss "$clamp_mss"
      echo "    added TCPMSS clamp -> ${clamp_mss} on tun0"
    else
      echo "    TCPMSS clamp already present"
    fi
  else
    echo "    !! iptables not found — skipping MSS clamp (install iptables to enable)"
  fi

  echo "==> Confirming glorytun UDP $GT_PORT is listening"
  if command -v ss >/dev/null 2>&1; then
    ss -ulnp 2>/dev/null | grep -q ":${GT_PORT}\b" \
      && echo "    OK: something is listening on UDP ${GT_PORT}" \
      || echo "    !! nothing on UDP ${GT_PORT} yet — start glorytun / check the port"
  fi

  echo
  echo "==> Accelerator applied. Summary:"
  show_status
  echo
  echo "Tip: reconnect the bond from the phone to pick up the new buffers."
}

case "${1:-apply}" in
  --status) show_status ;;
  --revert) revert ;;
  --install) install_service ;;
  apply|"") apply ;;
  *) echo "Usage: accelerator-tune.sh [--install|--status|--revert]"; exit 1 ;;
esac
