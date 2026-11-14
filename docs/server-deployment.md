# NDIView central server and dashboard deployment

The NDIView central server and dashboard are deployed together as one immutable release. The central server's existing data directories, Linux service account, systemd unit name, and `/etc/veyra/server.env` location remain stable for upgrade compatibility. New deployments should use `NDIVIEW_*` environment variables; the server still accepts the previous `VEYRA_*` names as aliases. The server serves the production Vite build from the same HTTPS origin, so operators do not run a separate Vite process in production. Refreshing the browser loads the current dashboard release.

## One-time signing setup

Create an Ed25519 release-signing key on a trusted build machine. Keep the private key offline and out of the repository:

```bash
openssl genpkey -algorithm ED25519 -out ndiview-release-private.pem
openssl pkey -in ndiview-release-private.pem -pubout -out ndiview-release-public.pem
```

Copy only the public key to the central server as `/etc/veyra/release-signing.pub` (the existing trust-store path is retained for upgrades), owned by root and mode `0644`. The private key is used only when packaging releases.

## Prepare the central Debian 13 server

- Install Debian 13 and Node.js 22 or newer.
- Provide a LAN TLS certificate and private key. The certificate must match the DNS name used by receivers and dashboard clients.
- Make the private key readable by the `veyra-server` group (for example root:veyra-server, mode `0640`).
- Create `/etc/veyra/server.env` from `config/server.env.example`, then adjust the host, port, TLS paths, and persistent paths.
- Keep the environment file root:veyra-server, mode `0640`.

The installer will create the environment template on first use if it is missing, then stop so you can configure TLS.

## Package a release

From a clean, committed checkout on the build machine:

```bash
export NDIVIEW_RELEASE_SIGNING_KEY=/secure/path/ndiview-release-private.pem
scripts/package-server-release.sh 0.2.0
```

The script creates a source archive, SHA-256 file, and Ed25519 signature under `dist/releases/`. The release archive contains the committed server and dashboard source; dependencies and production assets are built on the target Debian server.

## Install or update the central server

Copy the archive, signature, SHA-256 value, and trusted CA bundle to the central server. Use the HTTPS health URL whose hostname matches the certificate:

```bash
sudo scripts/install-server-release.sh \
  dist/releases/ndiview-0.2.0.tar.gz \
  YOUR_64_CHARACTER_SHA256 \
  dist/releases/ndiview-0.2.0.tar.gz.sig \
  0.2.0 \
  https://ndiview-server.local:8787/api/v1/health \
  /etc/ssl/certs/veyra-lan-ca.pem
```

The install script:
- Verifies SHA-256 and the Ed25519 signature against the public key already trusted on the server.
- Rejects archives with absolute paths or parent-directory traversal.
- Builds the server and dashboard in a new immutable release directory.
- Keeps the SQLite database, setup/pairing secrets, and media outside release directories.
- Stops the service, backs up persistent state, atomically switches `/opt/veyra/current`, and restarts.
- Checks the HTTPS health endpoint. If the new release fails, it restores the previous release automatically.

The dashboard is bundled into `dashboard/dist` and served by NDIView Server. HTML is revalidated on refresh; hashed assets receive immutable cache headers.

## Manual rollback

```bash
sudo scripts/rollback-server-release.sh 0.1.0 \
  https://ndiview-server.local:8787/api/v1/health \
  /etc/ssl/certs/veyra-lan-ca.pem
```

Keep at least the previous known-good release and regular off-machine backups. The automatic pre-update backup is stored under `/var/backups/veyra/`; it is not a substitute for an independent backup.

## Current limits

This workflow updates the central server and its dashboard together. It does not yet distribute native receiver updates to Mac minis from the dashboard. Receiver updates require their own signed artifact manifest, pinned public key, receiver-side staging/health check/rollback, and per-device rollout state; do not use `git pull` or run arbitrary shell commands on receivers.
