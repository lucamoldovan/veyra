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

On first launch, the server creates a local SQLite database and prints a one-time setup key in the server terminal. Keep that key private and enter it on the dashboard to create the first administrator. The key is stored in `data/setup-key` with owner-only permissions until setup succeeds, then deleted. A separate 32-byte pairing secret is generated in `data/pairing-secret` with owner-only permissions and must be backed up with the database; losing it invalidates outstanding pairing codes.

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
| `VEYRA_PAIRING_SECRET_PATH` | `data/pairing-secret` | Secret key used to HMAC pairing-code verifiers; back up securely with the database |
| `VEYRA_TLS_CERT_PATH` | unset | PEM certificate path; required with the private key for non-loopback binds |
| `VEYRA_TLS_KEY_PATH` | unset | PEM private key path; required with the certificate for non-loopback binds |
| `VEYRA_COOKIE_SECURE` | `false` on loopback HTTP; `true` with TLS | Force Secure session cookies |

The service binds to loopback by default. Binding to any non-loopback address is rejected unless both TLS certificate and private-key paths are configured. TLS uses a minimum of TLS 1.2, and session cookies are automatically marked Secure when TLS is enabled. Use a certificate trusted by the receiver devices; do not disable TLS or place bearer credentials on plaintext LAN HTTP.

## Current scope

Implemented:

- Fastify application factory for isolated tests.
- SQLite database with WAL mode, foreign keys, and persistent local storage.
- First-run administrator setup protected by a random one-time key printed to server logs.
- Scrypt password hashing, opaque random session tokens stored as SHA-256 hashes, HttpOnly/SameSite=Strict cookies, and 30-day session expiry.
- Rate-limited setup and login endpoints, plus session inspection and logout.
- Authenticated device inventory and one-time, 12-digit pairing codes (10-minute expiry), stored as HMAC-SHA-256 verifiers using a separate 32-byte local secret file.
- Single-use receiver pairing that returns a device ID and one-time device credential; only a hash of the credential is stored.
- Bearer-authenticated receiver heartbeats and derived online/stale/offline state.
- Operator-controlled device credential revocation and safe removal of revoked device records.
- Transactional SQLite schema migrations through version 2, including a populated version-1 upgrade test.
- Configurable bind address and port, TLS-enforced non-loopback binding, security response headers, health endpoint, and graceful shutdown.
- Automated server build and API tests in GitHub Actions.

Not implemented yet: the native receiver enrollment/heartbeat client, source inventory, WebSocket events, media storage, playlists, remote commands, and production dashboard serving.
