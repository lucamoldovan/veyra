#!/usr/bin/env bash
set -Eeuo pipefail
if [[ "${EUID}" -ne 0 ]]; then echo "Run with sudo: sudo bash scripts/install-kiosk-debian.sh" >&2; exit 1; fi
. /etc/os-release
if [[ "${ID:-}" != debian || "${VERSION_ID:-}" != 13 ]]; then
  echo "Debian 13 is required (detected: ${PRETTY_NAME:-unknown})." >&2; exit 1
fi
if [[ ! -x /usr/local/bin/ndiview ]]; then
  echo "NDIView binary missing. Build with the official NDI SDK, then run: sudo cmake --install build" >&2; exit 1
fi
if ! id veyra-kiosk >/dev/null 2>&1; then
  useradd --create-home --home-dir /home/veyra-kiosk --shell /bin/bash --user-group --groups video,render veyra-kiosk
else
  usermod --append --groups video,render veyra-kiosk
fi
install -d -o root -g veyra-kiosk -m 0750 /etc/ndiview
if [[ ! -e /etc/ndiview/config.json ]]; then
  if [[ -f /etc/veyra/config.json ]]; then
    install -o root -g veyra-kiosk -m 0640 /etc/veyra/config.json /etc/ndiview/config.json
  else
    [[ -f config/ndiview.example.json ]] || { echo "Run from repository root." >&2; exit 1; }
    install -o root -g veyra-kiosk -m 0640 config/ndiview.example.json /etc/ndiview/config.json
  fi
else
  chown root:veyra-kiosk /etc/ndiview/config.json
  chmod 0640 /etc/ndiview/config.json
fi
export DEBIAN_FRONTEND=noninteractive
printf '%s\n' 'lightdm shared/default-x-display-manager select lightdm' | debconf-set-selections
apt-get update
apt-get install --yes lightdm xserver-xorg x11-xserver-utils dbus-x11 unclutter sudo
install -d -m 0755 /usr/local/libexec /usr/share/xsessions /etc/lightdm/lightdm.conf.d /home/veyra-kiosk/.config/systemd/user
install -m 0755 scripts/ndiview-kiosk-session /usr/local/libexec/ndiview-kiosk-session
install -o root -g root -m 0755 scripts/ndiview-action /usr/local/libexec/ndiview-action
# Remove obsolete Veyra kiosk hooks and the old reboot-only privilege entry.
rm -f /etc/sudoers.d/veyra-reboot /usr/local/libexec/veyra-reboot
rm -f /etc/lightdm/lightdm.conf.d/50-veyra-kiosk.conf /usr/share/xsessions/veyra-kiosk.desktop
printf '%s\n' 'veyra-kiosk ALL=(root) NOPASSWD: /usr/local/libexec/ndiview-action restart, /usr/local/libexec/ndiview-action reboot' > /etc/sudoers.d/ndiview-action
chmod 0440 /etc/sudoers.d/ndiview-action
visudo -cf /etc/sudoers.d/ndiview-action
install -m 0644 systemd/ndiview.service /home/veyra-kiosk/.config/systemd/user/ndiview.service
rm -f /home/veyra-kiosk/.config/systemd/user/veyra.service /home/veyra-kiosk/.config/systemd/user/default.target.wants/veyra.service
chown -R veyra-kiosk:veyra-kiosk /home/veyra-kiosk/.config
cat > /usr/share/xsessions/ndiview-kiosk.desktop <<'SESSION'
[Desktop Entry]
Name=NDIView Kiosk
Comment=Fullscreen NDIView network video receiver
Exec=/usr/local/libexec/ndiview-kiosk-session
Type=Application
DesktopNames=NDIView
SESSION
cat > /etc/lightdm/lightdm.conf.d/50-ndiview-kiosk.conf <<'LIGHTDM'
[Seat:*]
autologin-user=veyra-kiosk
autologin-user-timeout=0
autologin-session=ndiview-kiosk
user-session=ndiview-kiosk
LIGHTDM
dpkg-reconfigure -f noninteractive lightdm
systemctl set-default graphical.target
systemctl enable lightdm
systemctl daemon-reload
echo "NDIView kiosk installed. Existing configuration and device state are preserved."
echo "Legacy /etc/veyra/config.json is copied only when /etc/ndiview/config.json does not exist."
echo "Reboot when configured: sudo reboot"
echo "Maintenance TTY: Ctrl+Alt+F3 (sign in with an administrator account)."
