#!/usr/bin/env bash
# Installs and enables the SDBEditor systemd services so the web editor
# (starter/auth on :5000, backend API on :3001, Vite UI on :5173)
# starts automatically on every server boot.
#
# Usage:
#   sudo bash install-autostart.sh          # install + enable + start now
#   sudo bash install-autostart.sh remove   # disable + remove the services
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
UNITS=(sdbeditor-starter.service sdbeditor-api.service sdbeditor-ui.service)

if [[ "${1:-}" == "remove" ]]; then
  echo "Removing SDBEditor systemd services..."
  systemctl disable --now "${UNITS[@]}" 2>/dev/null || true
  for unit in "${UNITS[@]}"; do
    rm -f "/etc/systemd/system/$unit"
  done
  systemctl daemon-reload
  echo "Done."
  exit 0
fi

if [[ "$(id -u)" -ne 0 ]]; then
  echo "This script must be run as root (use sudo)." >&2
  exit 1
fi

echo "Installing SDBEditor systemd unit files..."
for unit in "${UNITS[@]}"; do
  cp "$DIR/systemd/$unit" "/etc/systemd/system/$unit"
done

systemctl daemon-reload
systemctl enable --now "${UNITS[@]}"

echo ""
echo "Done. Services enabled to start on boot:"
systemctl --no-pager --plain list-units "${UNITS[@]}" || true
echo ""
echo "Open the setup page at: http://<server-ip>:5000"
echo "Web UI:                 http://<server-ip>:5173"
echo ""
echo "Logs:"
echo "  journalctl -u sdbeditor-starter -f"
echo "  journalctl -u sdbeditor-api -f"
echo "  journalctl -u sdbeditor-ui -f"
