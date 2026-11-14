# Veyra local server

Initial TypeScript/Fastify service for the Veyra local-network platform.

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

The service intentionally binds to loopback by default. Do not expose it to the LAN until operator authentication, receiver authentication, and the transport-security policy have been implemented.

## Current scope

Implemented:

- Fastify application factory for isolated tests.
- `GET /api/v1/health`.
- Configurable bind address and port.
- Graceful shutdown on SIGINT and SIGTERM.
- TypeScript build and endpoint tests in GitHub Actions.

Not implemented yet: database, operator authentication, device pairing, receiver API, WebSocket events, media storage, playlists, remote commands, and dashboard integration.
