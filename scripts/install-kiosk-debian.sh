#!/usr/bin/env bash
set -Eeuo pipefail
if [[ "${EUID}" -ne 0 ]]; then echo "Run with sudo: sudo bash scripts/install-kiosk-debian.sh" >&2; exit 1; fi
. /etc/os-release
if [[ "${ID:-}" != debian || "${VERSION_ID:-}" != 13 ]]; then
  echo "Debian 13 is required (detected: ${PRETTY_NAME:-unknown})." >&2; exit 1
fi
if [[ ! -x /usr/local/bin/veyra ]]; then
  echo "Veyra binary missing. Build with the official NDI SDK, then run: sudo cmake --install build" >&2; exit 1
fi
if ! id veyra-kiosk >/dev/null 2>&1; then
  useradd --create-home --home-dir /home/veyra-kiosk --shell /bin/bash --user-group --groups video,render veyra-kiosk
else
  usermod --append --groups video,render veyra-kiosk
fi
install -d -o root -g veyra-kiosk -m 0750 /etc/veyra
if [[ ! -e /etc/veyra/config.json ]]; then
  [[ -f config/veyra.example.json ]] || { echo "Run from repository root." >&2; exit 1; }
  install -o root -g veyra-kiosk -m 0640 config/veyra.example.json /etc/veyra/config.json
else
  chown root:veyra-kiosk /etc/veyra/config.json
  chmod 0640 /etc/veyra/config.json
fi
export DEBIAN_FRONTEND=noninteractive
printf '%s\n' 'lightdm shared/default-x-display-manager select lightdm' | debconf-set-selections
apt-get update
apt-get install --yes lightdm xserver-xorg x11-xserver-utils dbus-x11 unclutter
install -d -m 0755 /usr/local/libexec /usr/share/xsessions /etc/lightdm/lightdm.conf.d /home/veyra-kiosk/.config/systemd/user
install -m 0755 scripts/veyra-kiosk-session /usr/local/libexec/veyra-kiosk-session
install -m 0644 systemd/veyra.service /home/veyra-kiosk/.config/systemd/user/veyra.service
chown -R veyra-kiosk:veyra-kiosk /home/veyra-kiosk/.config
cat > /usr/share/xsessions/veyra-kiosk.desktop <<'SESSION'
[Desktop Entry]
Name=Veyra Kiosk
Comment=Fullscreen Veyra network video receiver
Exec=/usr/local/libexec/veyra-kiosk-session
Type=Application
DesktopNames=Veyra
SESSION
cat > /etc/lightdm/lightdm.conf.d/50-veyra-kiosk.conf <<'LIGHTDM'
[Seat:*]
autologin-user=veyra-kiosk
autologin-user-timeout=0
autologin-session=veyra-kiosk
user-session=veyra-kiosk
LIGHTDM
dpkg-reconfigure -f noninteractive lightdm
systemctl set-default graphical.target
systemctl enable lightdm
systemctl daemon-reload
echo "Veyra kiosk installed. Existing config preserved at /etc/veyra/config.json."
echo "Reboot when configured: sudo reboot"
echo "Maintenance TTY: Ctrl+Alt+F3 (sign in with an administrator account)."
