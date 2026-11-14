# Veyra

**Network video. Simplified.**

Veyra is a local-network video and display platform built around lightweight NDI receivers, a local management server, and a browser-based dashboard.

Its first deployment environment is churches, but Veyra is designed as a general-purpose network-video product.

## The platform

- **Veyra Receiver** — native Linux playback process for video-only NDI reception, fullscreen display, and locally cached fallback playback.
- **Veyra Server** — local management service for authentication, devices, sources, media, playlists, configuration, commands, and system state.
- **Veyra Dashboard** — browser-based interface for device management, NDI source assignment, media, playlists, diagnostics, and system settings.

The server is hosted locally and communicates with receivers over the LAN. Receivers keep their last valid configuration and their own fallback content locally, so playback can continue during a server outage. Each receiver has its own fallback assignment.

NDI audio is intentionally not captured or played.

## Current implementation status

The repository currently contains the **native receiver foundation**, a React/Vite dashboard, and a SQLite-backed TypeScript/Fastify server. The dashboard includes workspace navigation, an overview, Devices, NDI Sources, Media Library, Playlists, and System pages, plus first-run administrator setup, sign-in, sign-out, and live server health. The server supports persistent local storage, operator sessions, one-time receiver pairing, authenticated heartbeats, and a protected device inventory. The native receiver enrollment client, remote configuration, and source/media/playlist management remain in development.

The native receiver foundation includes:

- Discovers NDI sources on the local network.
- Selects a source using its NDI address, or its name as a fallback.
- Receives video without opening an audio stream.
- Uses a one-frame latest-value slot between capture and rendering, avoiding an ever-growing latency queue.
- Renders fullscreen through SDL2, preserving the source aspect ratio.
- Clears the display after two seconds without a fresh frame.
- Leaves the NDI receiver alive during source loss so the SDK can reconnect when the source returns.
- Loads and validates local JSON configuration.

Receiver-side enrollment, source discovery/reporting, media uploads, playlist editing, remote commands, and per-device cached fallback are **not yet implemented**. The server can issue one-time pairing codes, register a receiver, accept authenticated heartbeats, and provide a protected device inventory. The dashboard's current empty states are intentional and do not use fabricated device or media data. On first server launch, copy the one-time setup key from the server terminal into the dashboard to create the local administrator.

The player has not yet been compiled against an installed official NDI SDK or validated on the target Mac mini. The SDK-independent configuration tests run in GitHub Actions. See the [development plan](docs/development.md) for implementation and validation status.

## Run the dashboard

Start the local server in one terminal:

\`\`\`bash
cd server
npm install
npm run dev
\`\`\`

Start the dashboard in another terminal:

\`\`\`bash
cd dashboard
npm install
npm run dev
\`\`\`

Open http://127.0.0.1:5173. During development, Vite proxies API requests to the local server at http://127.0.0.1:8787. See [dashboard/README.md](dashboard/README.md) for details.

## Architecture

See [docs/architecture.md](docs/architecture.md) for the system topology, component responsibilities, offline behavior, security boundaries, and implementation proposals.

## Receiver requirements

- Debian 13, 64-bit x86_64
- C++20 compiler
- CMake 3.20+
- SDL2 development files
- spdlog
- nlohmann/json
- Official NDI SDK for Linux
- Avahi daemon for LAN discovery

Install the Debian dependencies:

```bash
sudo apt update
sudo apt install build-essential cmake pkg-config libsdl2-dev libspdlog-dev nlohmann-json3-dev avahi-daemon
sudo systemctl enable --now avahi-daemon
```

Install the official NDI SDK separately and keep its proprietary files out of this repository.

## Build the receiver

Point CMake at the SDK installation directory:

```bash
cmake -S . -B build -DNDI_SDK_DIR=/path/to/ndi/sdk
cmake --build build --parallel
```

If the SDK is installed into standard system include/library directories, CMake may find it without an explicit `NDI_SDK_DIR`.

## Configure and run

Create the system configuration directory and copy the example:

```bash
sudo install -d /etc/veyra
sudo cp config/veyra.example.json /etc/veyra/config.json
sudo nano /etc/veyra/config.json
```

Before editing the config, list the sources visible on the LAN:

```bash
./build/veyra --list-sources
```

Set `ndi.sourceAddress` to the address printed by that command. This is preferred because it identifies the NDI source more precisely. If the address is unavailable, set `ndi.sourceName`. If neither is set, Veyra selects a source automatically only when exactly one source remains after the initial five-second discovery window and a further two-second stable-source window.

Run the player:

```bash
./build/veyra --config /etc/veyra/config.json
```

Press Escape to exit during development.

## Start automatically with XFCE

The supplied systemd user service starts Veyra as part of the desktop user's session and restarts it if the process exits.

Install the binary and user service:

```bash
sudo cmake --install build
mkdir -p ~/.config/systemd/user
cp systemd/veyra.service ~/.config/systemd/user/veyra.service
systemctl --user daemon-reload
systemctl --user enable --now veyra.service

systemctl --user status veyra.service
journalctl --user -u veyra.service -f
```

The service defaults to X11 display :0 and `~/.Xauthority`. If your XFCE session uses different values, update the `DISPLAY` and `XAUTHORITY` entries in the service file. For unattended boot, configure your display manager to automatically log in to the same desktop user; the user service starts with that session.

Avahi must be enabled at the system level:

```bash
sudo systemctl enable --now avahi-daemon
```

## Run configuration tests without the NDI SDK

```bash
cmake -S . -B build-tests -DVEYRA_BUILD_PLAYER=OFF -DVEYRA_BUILD_TESTS=ON
cmake --build build-tests --parallel
ctest --test-dir build-tests --output-on-failure
```

## Documentation

- [Architecture](docs/architecture.md)
- [Control-plane contract (draft)](docs/control-plane-contract.md)
- [Development plan](docs/development.md)
- [Third-party licensing](LICENSE-THIRD-PARTY.md)
