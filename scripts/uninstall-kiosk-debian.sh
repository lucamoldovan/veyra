#!/usr/bin/env bash
set -Eeuo pipefail
if [[ "${EUID}" -ne 0 ]]; then echo "Run with sudo: sudo bash scripts/uninstall-kiosk-debian.sh" >&2; exit 1; fi
systemctl disable --now lightdm 2>/dev/null || true
rm -f /etc/lightdm/lightdm.conf.d/50-veyra-kiosk.conf /usr/share/xsessions/veyra-kiosk.desktop /usr/local/libexec/veyra-kiosk-session
rm -f /home/veyra-kiosk/.config/systemd/user/veyra.service
systemctl set-default graphical.target
systemctl daemon-reload
echo "Removed Veyra LightDM integration. Config, credentials, cache and kiosk account were preserved."
echo "Select/enable your preferred display manager before reboot."
