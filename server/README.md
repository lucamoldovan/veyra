# Veyra local server

TypeScript/Fastify service and SQLite-backed control plane for the Veyra local-network platform.

## Requirements

- Node.js 22 or newer
- npm

## Development

From this directory:

```bash
npm install
npm run dev
```

The development server listens on `127.0.0.1:8787` by default.

On first launch, the server creates a local SQLite database and prints a one-time setup key in the server terminal. Keep that key private and enter it on the dashboard to create the first administrator. The key is stored in `data/setup-key` with owner-only permissions until setup succeeds, then deleted.

Check the health endpoint:

```bash
curl http://127.0.0.1:8787/api/v1/health
```

## Build and test

```bash
npm run build
npm test
npm start
```

## Configuration

| Variable | Default | Description |
|---|---|---|
| `VEYRA_HOST` | `127.0.0.1` | Bind address |
| `VEYRA_PORT` | `8787` | HTTP port |
| `LOG_LEVEL` | `info` | Fastify/Pino log level |
| `VEYRA_DATABASE_PATH` | `data/veyra.sqlite` | SQLite database path |
| `VEYRA_SETUP_KEY_PATH` | `data/setup-key` | First-run setup key file |
| `VEYRA_COOKIE_SECURE` | `false` | Set to `true` when served over HTTPS |

The service intentionally binds to loopback by default. Local operator setup and session authentication are implemented, but receiver authentication and the transport-security policy for LAN deployment are not. Do not expose it to the LAN yet.

## Current scope

Implemented:

- Fastify application factory for isolated tests.
- SQLite database with WAL mode, foreign keys, and persistent local storage.
- First-run administrator setup protected by a random one-time key printed to server logs.
- Scrypt password hashing, opaque random session tokens stored as SHA-256 hashes, HttpOnly/SameSite=Strict cookies, and 30-day session expiry.
- Rate-limited setup and login endpoints, plus session inspection and logout.
- Configurable bind address and port, health endpoint, and graceful shutdown.
- Automated server build and API tests in GitHub Actions.

Not implemented yet: receiver pairing/authentication, device registry and heartbeats, receiver API, WebSocket events, media storage, playlists, remote commands, and production dashboard serving.
