#!/usr/bin/env bash
set -Eeuo pipefail
if [[ "${EUID}" -ne 0 ]]; then echo "Run with sudo: sudo bash scripts/uninstall-kiosk-debian.sh" >&2; exit 1; fi
systemctl disable --now lightdm 2>/dev/null || true
rm -f /etc/lightdm/lightdm.conf.d/50-ndiview-kiosk.conf /usr/share/xsessions/ndiview-kiosk.desktop /usr/local/libexec/ndiview-kiosk-session
rm -f /etc/lightdm/lightdm.conf.d/50-veyra-kiosk.conf /usr/share/xsessions/veyra-kiosk.desktop
rm -f /home/veyra-kiosk/.config/systemd/user/ndiview.service /home/veyra-kiosk/.config/systemd/user/default.target.wants/ndiview.service
rm -f /etc/sudoers.d/ndiview-action /usr/local/libexec/ndiview-action /usr/local/libexec/veyra-reboot
systemctl set-default graphical.target
systemctl daemon-reload
echo "Removed NDIView LightDM integration. Configuration, credentials, cache and kiosk account were preserved."
echo "Select/enable your preferred display manager before reboot."
