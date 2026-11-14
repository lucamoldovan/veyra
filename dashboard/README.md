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
npm install
npm run dev
```

Terminal 2 — start the dashboard:

```bash
cd dashboard
npm install
npm run dev
```

Open http://127.0.0.1:5173. On first launch, copy the one-time setup key printed in the server terminal into the setup screen. The Vite development server proxies `/api` requests to the local server at `127.0.0.1:8787`.

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
- Protected receiver inventory with online/stale/offline state and heartbeat details.
- One-time receiver pairing-code generation with copy-to-clipboard and expiry display.
- Live local-server health indicator, polled every 15 seconds.
- System status page showing server, database, receiver network, and security implementation state.
- Dedicated Devices, NDI Sources, Media Library, and Playlists sections that explain their next integration steps.

Not implemented yet: the receiver-side enrollment client, live NDI source discovery, media uploads, playlist editing, and remote commands. The UI does not fabricate devices, sources, activity, or server health.
