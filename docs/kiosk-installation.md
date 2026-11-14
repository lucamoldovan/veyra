# Debian 13 kiosk installation

This deployment layer configures a dedicated LightDM/Xorg session that automatically starts NDIView after boot. It does not install the proprietary NDI SDK or build the player.

## Before installing

1. Install Debian 13 64-bit on the receiver.
2. Confirm Ethernet and the target display work.
3. Install the official Linux NDI SDK separately, following its license.
4. Install build dependencies from the root README.
5. Build and install the player:
   \`\`\`bash
   cmake -S . -B build -DNDI_SDK_DIR=/path/to/ndi/sdk
   cmake --build build --parallel
   sudo cmake --install build
   \`\`\`
6. Confirm \`/usr/local/bin/ndiview --list-sources\` sees the expected sender.

## Install

Run from the repository root:

\`\`\`bash
sudo bash scripts/install-kiosk-debian.sh
\`\`\`

The installer requires Debian 13, creates the unprivileged \`veyra-kiosk\` account (video/render groups only), installs LightDM/Xorg, and configures automatic login into a minimal NDIView X session. It preserves an existing \`/etc/ndiview/config.json\`; if absent, it installs the example. The NDIView dashboard's operator authentication is unchanged.

## Configure

Edit \`/etc/ndiview/config.json\` as an administrator. Keep it owned by \`root:veyra-kiosk\` with mode \`0640\`. Set the central server HTTPS URL, device name and CA trust path if using a private CA. Pair the receiver in the dashboard and assign its NDI source before unattended operation.

## Reboot and verify

\`\`\`bash
sudo reboot
\`\`\`

Expected: Debian boots, LightDM logs into \`veyra-kiosk\`, the session disables X11 blanking/DPMS and blocks idle/sleep, then starts the systemd user service. The session wrapper stays alive so LightDM does not tear down the graphical session immediately after the \`Type=simple\` receiver service starts. systemd restarts the receiver on process failure. NDIView's SDL renderer already requests fullscreen.

Maintenance: press Ctrl+Alt+F3 and sign in with an administrator account. Inspect boot logs with \`journalctl -b | grep -i ndiview\`. The service uses bounded restart behavior (five starts per minute) to avoid an infinite crash loop.

## Uninstall

\`\`\`bash
sudo bash scripts/uninstall-kiosk-debian.sh
\`\`\`

This removes only NDIView's LightDM session and service file. It preserves configuration, credentials, cache and the kiosk account. Select/enable another display manager before reboot.

## Required physical validation

This code is not proof of hardware success. On one Mac mini, test cold boot, HDMI reconnect, resolution changes, sender/server unavailable at boot, network loss, player crash recovery, and continuous 24-hour playback before fleet deployment.
