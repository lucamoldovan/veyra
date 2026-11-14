# Veyra Dashboard

React + TypeScript dashboard for the local Veyra network-video platform.

## Requirements

- Node.js 22 or newer
- npm
- Veyra local server running on `127.0.0.1:8787`

## Development

Terminal 1 — start the local server:

```bash
cd server
npm ci
npm run dev
```

Terminal 2 — start the dashboard:

```bash
cd dashboard
npm ci
npm run dev
```

Open http://127.0.0.1:5173. On first launch, copy the one-time setup key printed in the server terminal into the setup screen. The Vite development server proxies `/api` requests to `http://127.0.0.1:8787` by default. To develop against a TLS-enabled server, set `VEYRA_API_TARGET` to its HTTPS origin before starting Vite (for example, `VEYRA_API_TARGET=https://localhost:8787 npm run dev`). The certificate must be trusted by Node.js; do not disable TLS certificate verification.

## Build

```bash
npm run build
npm run preview
```

## Current scope

Implemented:

- First-run administrator setup using a one-time key printed in the server terminal.
- Local username/password sign-in and sign-out using HttpOnly session cookies.
- Responsive application shell and workspace navigation.
- Overview with honest empty states for unregistered devices and media.
- Protected receiver inventory with online/stale/offline state, heartbeat details, credential revocation, safe removal, and a confirmed receiver-restart action with command status.
- One-time receiver pairing-code generation with copy-to-clipboard and expiry display.
- Live local-server health indicator, polled every 15 seconds.
- System status page showing server, database, receiver network, and security implementation state.
- NDI Sources page displaying aggregated receiver-reported source snapshots.
- Per-device NDI source and fallback-playlist assignment controls.
- Media Library with authenticated PNG/JPEG/WebP uploads, previews, metadata, and deletion protection for playlist-referenced assets.
- Playlist editor with create/delete, ordered image items, per-image display durations, and save/reload.

Not implemented yet: live WebSocket updates, detailed logs/diagnostics, and native receiver update controls. In production, the built dashboard is served by the central Veyra server; see [the server deployment guide](../docs/server-deployment.md). NDI source data appears after a receiver reports its discovery snapshot; an empty source list is expected before a receiver has paired and reported.
