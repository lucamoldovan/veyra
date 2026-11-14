# Veyra

**Network video. Simplified.**

Veyra is a local-network video and display platform built around lightweight NDI receivers, a local management server, and a browser-based dashboard.

Its first deployment environment is churches, but Veyra is designed as a general-purpose network-video product.

## The platform

- **Veyra Receiver** — native Linux playback process for video-only NDI reception, fullscreen display, and per-device cached image fallback.
- **Veyra Server** — local management service for authentication, devices, sources, media, playlists, configuration, commands, and system state.
- **Veyra Dashboard** — browser-based interface for device management, NDI source assignment, media, playlists, diagnostics, and system settings.

The server is designed to run locally and manage receivers over the LAN. The intended offline model keeps the last valid configuration and each receiver's assigned fallback content on that receiver. The receiver now polls versioned configuration and assigned-media manifests, verifies and caches assets locally, and plays its cached fallback when its assigned NDI source is unavailable or the server is offline.

NDI audio is intentionally not captured or played.

## Current implementation status

The repository currently contains an early **native receiver foundation**, a React/Vite dashboard, and a SQLite-backed TypeScript/Fastify server. The dashboard includes workspace navigation, an overview, Devices, NDI Sources, Media Library, Playlists, and System pages, plus first-run administrator setup, sign-in, sign-out, and live server health. The server supports persistent local storage, operator sessions, one-time receiver pairing, authenticated heartbeats, a protected device inventory, operator-controlled credential revocation, image uploads, and playlist management. SQLite schema upgrades are versioned and tested against a populated version-1 database. Non-loopback server binding now requires configured TLS certificate and private-key files. The C++ receiver control-plane client now implements pairing, TLS-verified heartbeats, source snapshots, versioned configuration polling, SHA-256-verified media synchronization, persistent cache loading, and timed image fallback. Per-device source and fallback-playlist assignment are available in the dashboard. The receiver integration is compiled in SDK-independent CI, but the complete player has not yet been built against the official NDI SDK or tested on the target hardware. The dashboard now includes a receiver-reported NDI source inventory page. The dashboard now includes a working local image library and ordered playlist editor. Server and dashboard dependencies are pinned with committed npm lockfiles and installed reproducibly in CI. The server and dashboard still use separate development processes; production dashboard serving and packaging are not implemented.

The native receiver foundation includes:

- Discovers NDI sources on the local network.
- Selects a source using its NDI address, or its name as a fallback.
- Receives video without opening an audio stream.
- Uses a one-frame latest-value slot between capture and rendering, avoiding an ever-growing latency queue.
- Renders fullscreen through SDL2, preserving the source aspect ratio.
- Clears the display after two seconds without a fresh frame.
- Leaves the NDI receiver alive during source loss so the SDK can reconnect when the source returns.
- Loads and validates local JSON configuration.

Receiver-side pairing, discovery heartbeat reporting, configuration polling, verified local media caching, and timed image fallback are implemented in the C++ receiver. The complete native player still needs an official NDI SDK build and hardware validation. Remote commands, WebSocket events, production packaging, and full diagnostics are **not yet implemented**. The server can aggregate source snapshots reported by receivers, and the dashboard can display that inventory. The dashboard's Media Library supports local PNG/JPEG/WebP uploads, and Playlists supports ordered image sequences with editable display durations. The server can issue one-time pairing codes, register a receiver, accept authenticated heartbeats, and provide a protected device inventory. Empty states are used only where a feature is not yet connected; the media library and playlist editor use persisted server data. On first server launch, copy the one-time setup key from the server terminal into the dashboard to create the local administrator.

The player has not yet been compiled against an installed official NDI SDK or validated on the target Mac mini. SDK-independent CI builds the renderer and control-plane client, runs configuration and mock-server pairing, heartbeat, media-sync, and cache-integrity tests, and tests the server and dashboard. See the [development plan](docs/development.md) for implementation and validation status.

## Run the dashboard

Start the local server in one terminal:

\`\`\`bash
cd server
npm ci
npm run dev
\`\`\`

Start the dashboard in another terminal:

\`\`\`bash
cd dashboard
npm ci
npm run dev
\`\`\`

Open http://127.0.0.1:5173. During development, Vite proxies API requests to the local server at http://127.0.0.1:8787. See [dashboard/README.md](dashboard/README.md) for details.

## Receiver kiosk deployment

See [the Debian 13 kiosk installation guide](docs/kiosk-installation.md) for automatic fullscreen startup, recovery behavior, maintenance access and physical validation.

## Central server deployment

See [the central server and dashboard deployment guide](docs/server-deployment.md) for signed releases, HTTPS hosting, backups and rollback.

## Architecture

See [docs/architecture.md](docs/architecture.md) for the system topology, component responsibilities, offline behavior, security boundaries, and implementation proposals.

## Receiver requirements

- Debian 13, 64-bit x86_64
- C++20 compiler
- CMake 3.20+
- SDL2 and SDL2_image development files
- libcurl and OpenSSL development files
- spdlog
- nlohmann/json
- Official NDI SDK for Linux
- Avahi daemon for LAN discovery

Install the Debian dependencies:

```bash
sudo apt update
sudo apt install build-essential cmake pkg-config libsdl2-dev libsdl2-image-dev libcurl4-openssl-dev libssl-dev libspdlog-dev nlohmann-json3-dev avahi-daemon
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
sudo install -d -m 755 /etc/veyra
sudo install -m 600 config/veyra.example.json /etc/veyra/config.json
sudo chown "$USER":"$(id -gn)" /etc/veyra/config.json
nano /etc/veyra/config.json
```

Before editing the config, list the sources visible on the LAN:

```bash
./build/veyra --list-sources
```

Set `ndi.sourceAddress` to the address printed by that command. This is preferred because it identifies the NDI source more precisely. If the address is unavailable, set `ndi.sourceName`. If neither is set, Veyra selects a source automatically only when exactly one source remains after the initial five-second discovery window and a further two-second stable-source window.

To enroll the receiver with the local server, configure the optional `controlPlane` section in `/etc/veyra/config.json`:

- Set `serverUrl` to the server's HTTPS origin, for example `https://veyra-server.local:8787`.
- Set `deviceName` to a unique display name.
- Create a fresh 12-digit pairing code in the dashboard and set `pairingCode`.
- Set `caCertificatePath` if the server uses a private CA that is not already trusted by the operating system.
- Leave `credentialPath` at its default unless you need a different protected location.

The client verifies TLS certificates and rejects plaintext HTTP to non-loopback hosts. After pairing, it stores the device token in an owner-only file, sends heartbeats and NDI discovery snapshots, and synchronizes assigned configuration and media into the local cache. If the server becomes unavailable, the receiver keeps using its last verified cache. If the credential is revoked, stop Veyra, remove the token file, create a new pairing code, and pair again. See [the Mac mini validation checklist](docs/mac-mini-validation.md) for the full sequence.

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

## Run SDK-independent C++ tests

```bash
cmake -S . -B build-tests -DVEYRA_BUILD_PLAYER=OFF -DVEYRA_BUILD_TESTS=ON
cmake --build build-tests --parallel
ctest --test-dir build-tests --output-on-failure
```

## Documentation

- [Architecture](docs/architecture.md)
- [Control-plane contract (draft)](docs/control-plane-contract.md)
- [Development plan](docs/development.md)
- [Target Mac mini validation checklist](docs/mac-mini-validation.md)
- [Third-party licensing](LICENSE-THIRD-PARTY.md)
