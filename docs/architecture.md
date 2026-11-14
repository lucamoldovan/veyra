# Veyra architecture

## Product vision

**Veyra — Network video. Simplified.**

Veyra is a local-network video and display platform. Its first deployment environment is churches, but the product is general-purpose and is not defined by that environment.

The platform combines:

- A browser-based dashboard for operators.
- A local server that acts as the management authority.
- Lightweight receiver devices that play NDI video and locally cached fallback content.

The receiver remains useful on its own: playback must not depend on the dashboard, the server, or an internet connection.

## Confirmed product decisions

| Area | Decision |
|---|---|
| Server hosting | Local, on the customer's network |
| Device communication | LAN |
| Receiver fallback | Per-device |
| NDI audio | Disabled; video only |
| Internet dependency | None for normal local operation |
| Initial receiver target | Debian 13 on x86_64, including the Late-2014 Mac mini |

The dashboard and server are part of the product scope. The repository now includes the dashboard foundation and a local server with persistent SQLite storage and operator authentication. The server can now create one-time pairing codes, register devices, accept authenticated heartbeats, expose a protected device inventory, store local image assets, manage ordered playlists with per-image durations, and aggregate NDI source snapshots reported by receivers. The native receiver enrollment client, NDI source inventory, and device-to-playlist assignment are still in development.

## System topology

```text
                    Local network (LAN)
  +------------------------------------------------------+
  |                                                      |
  |  Operator browser                                    |
  |       |                                              |
  |       v                                              |
  |  +--------------------+      +-------------------+  |
  |  | Veyra Dashboard    |<---->| Veyra Local Server|  |
  |  | Devices / Sources  | API  | Auth / Database   |  |
  |  | Media / Playlists  | WS   | Sync / Commands   |  |
  |  | System / Logs      |      | Device registry   |  |
  |  +--------------------+      +---------+---------+  |
  |                                         |            |
  |                    +--------------------+---------+  |
  |                    |                    |         |  |
  |                    v                    v         v  |
  |              +-----------+        +-----------+  ... |
  |              | Receiver  |        | Receiver  |      |
  |              | NDI video |        | NDI video |      |
  |              | Local     |        | Local     |      |
  |              | fallback  |        | fallback  |      |
  |              +-----------+        +-----------+      |
  |                                                      |
  +------------------------------------------------------+
```

The dashboard is the operator interface. The local server owns shared configuration, device registration, media catalogues, playlists, and command coordination. Each receiver owns its playback process and local cache.

## Main components

### 1. Veyra Receiver

A small native Linux process responsible for reliable display output.

Current implementation:

- C++20, CMake, official NDI SDK, SDL2.
- LAN NDI discovery and source selection.
- Video-only NDI capture (no audio or metadata capture).
- Fullscreen rendering with aspect-ratio preservation.
- A bounded latest-frame slot between capture and rendering.
- Local JSON configuration.
- Frame-staleness detection and a black-screen state.
- Graceful shutdown and systemd deployment support.

Planned receiver capabilities:

- Complete the receiver-side enrollment flow using a one-time code and persist its issued device credential securely.
- Register and identify itself with the local server.
- Send periodic heartbeats and playback/health state.
- Receive configuration and playback commands over the LAN.
- Cache assigned media and its per-device fallback playlist.
- Continue playback when the server is unavailable.
- Use its configured fallback when its selected NDI source is unavailable.
- Reconnect to the NDI source and synchronize with the server when connectivity returns.

The receiver must not require the dashboard or server to remain running for normal playback.

### 2. Veyra Local Server

A service running on the customer's local network. It is the management authority, not part of the critical video-rendering path.

Responsibilities:

- Local operator authentication and sessions.
- Device registration, identity, and last-seen state.
- Device heartbeats and status aggregation.
- NDI source inventory and source assignment.
- Media upload, storage, and library metadata.
- Playlist and per-device assignment management.
- Configuration distribution and synchronization.
- Remote commands, including changing source, selecting a playlist, requesting a resync, and restarting the receiver process.
- Playback state, health metrics, logs, and diagnostics.

The server currently exposes a versioned health endpoint, local operator setup/session routes, protected device inventory, one-time receiver pairing, authenticated heartbeat ingestion with optional source snapshots, an aggregated NDI source inventory endpoint, local image upload/storage, and playlist CRUD. The planned control plane will add a LAN API for request/response operations and a persistent WebSocket channel for heartbeats, live state, and commands. Receiver authentication and the LAN transport-security policy must be specified before LAN deployment.

The server currently uses a local SQLite database in WAL mode with versioned migrations through schema version 3. The initial operator authentication uses scrypt password hashes, random opaque session tokens stored as hashes, HttpOnly/SameSite=Strict cookies, and rate-limited setup/login routes. The server defaults to loopback binding. It is not a cloud service; do not introduce an internet account, external database, or mandatory third-party runtime dependency.

### 3. Veyra Dashboard

A browser-based operator interface that communicates with the local server. The current development build runs through Vite. The NDI Sources page displays receiver-reported source inventory; the Media Library and Playlists pages use the local server for image uploads, content previews, ordered playlist editing, and per-image durations; production static serving is still to be implemented.

Primary sections:

- **Devices:** device list, online/offline state, current playback, assigned content, health, and per-device actions.
- **Sources:** discovered NDI sources and receiver source assignments.
- **Media:** uploaded media library, reuse of media across displays, and media metadata.
- **Playlists:** create and edit ordered content sequences, configure image durations, and assign playlists to individual receivers or groups.
- **System:** server health, receiver diagnostics, logs, and platform settings.

Per-device actions should include changing the NDI source, selecting a playlist, restarting the Veyra receiver process, requesting configuration/media resynchronization, and viewing that device's logs.

The dashboard should make the state of each device understandable at a glance. It must distinguish server reachability from receiver playback state; an offline server does not necessarily mean a receiver is offline.

## Playback, caching, and fallback

There are two distinct failure cases and they must not be conflated.

### NDI source unavailable

1. The receiver detects that fresh NDI video is no longer arriving.
2. It transitions to the fallback assigned to that specific receiver.
3. The fallback playlist is played from the receiver's local cache.
4. The receiver continues checking for its assigned NDI source.
5. When the source returns, the receiver resumes NDI playback according to the recovery policy.

### Local server unavailable

1. The receiver keeps its last successfully applied configuration.
2. It continues current playback.
3. If its NDI source becomes unavailable, it can still use its locally cached fallback playlist.
4. It queues or retries state synchronization until the server is reachable again.

A receiver must never need to fetch fallback media at the moment a failure occurs. Required fallback assets and configuration must already be local.

### Per-device ownership

Each receiver has its own fallback assignment and local cache. A fallback configured for one display must not silently replace another device's fallback. The server distributes assignments; the receiver stores the last valid version locally.

The initial fallback content scope includes image-based sequences with explicit ordering and display durations. Any additional media types should be added only after their playback and caching requirements are defined.

## Communication and trust boundaries

- Dashboard-to-server traffic stays on the LAN.
- Receiver-to-server traffic stays on the LAN.
- NDI discovery and video transport remain separate from the management API.
- The receiver's playback loop must not block on server requests.
- Device identity and authentication must be designed before exposing remote commands.
- Remote commands need acknowledgements, timeouts, and observable outcomes.
- Configuration and media updates should be versioned and applied atomically so a partial download cannot corrupt the last working state.

Do not expose an unauthenticated remote shell or arbitrary command execution. A restart action should invoke a narrowly defined receiver operation, not accept arbitrary shell text.

## Proposed implementation boundaries

These are implementation proposals, not immutable product requirements:

- Keep the existing native C++ receiver as its own component.
- Implement the local server as a separate service.
- Implement the dashboard as a separate web application.
- Use a small embedded database for local server state.
- Use a typed, versioned HTTP API plus WebSockets for live state and commands.
- Keep receiver configuration and cached fallback data on disk.

The current implementation uses Node.js 22+, TypeScript, Fastify 5, React 19, Vite 6, and SQLite via better-sqlite3. The database and initial framework choices are therefore settled for the current development phase. API evolution, device transport security, schema migrations, and media storage still require explicit design and validation.

## Repository status

The repository currently contains three foundations: a native NDI receiver, a Fastify/SQLite local server, and a React/Vite dashboard. Implemented server capabilities include operator setup and sessions, one-time receiver pairing, authenticated heartbeats, and a protected device inventory. The dashboard includes authentication, server health, navigation, and device inventory/pairing-code management. NDI source inventory, receiver-side pairing/heartbeat, media uploads, playlists, remote commands, fallback playback, WebSocket updates, and production dashboard serving remain unimplemented.

The full NDI player has not yet been built against an installed official NDI SDK or tested with a real sender on the target Mac mini. Do not describe the platform as production-ready until the receiver, server, dashboard, offline behavior, and target hardware have all been validated.

## Target environment

- Debian 13, 64-bit x86_64, XFCE/X11 during initial development.
- Apple Mac mini (Late 2014), Intel Core i5-4278U, 8 GB RAM, Intel Iris 5100.
- Initial display target: 1920×1080 at 30 FPS.
- Wired LAN preferred.
- The target machine has a mechanical HDD; development must not assume an SSD.

## Third-party licensing

The official NDI SDK is proprietary. Keep its headers and binaries out of the repository unless the applicable license explicitly permits redistribution. Review all third-party licenses before packaging Veyra for distribution.
