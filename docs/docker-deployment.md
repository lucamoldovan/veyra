# Temporary Windows Docker deployment

This deployment is for a trusted local network while the permanent NDIView server is not yet available. It builds the production dashboard and serves it from the same HTTPS origin as the Fastify API. It does not put NDI video through Docker: NDI senders continue streaming directly to each receiver.

## Architecture

- One application container runs the NDIView server and serves the compiled dashboard.
- One named Docker volume stores the SQLite database, setup key, pairing secret, and uploaded media.
- TLS certificate and key files are mounted read-only.
- The receiver connects to the laptop over the LAN using HTTPS on port 8787 by default.

Use Docker Desktop with the WSL 2 backend and a current Docker Compose plugin. Node.js is built inside the image; Node does not need to be installed on Windows.

## 1. Find the laptop's LAN IPv4 address

In PowerShell:

```powershell
ipconfig
```

Find the IPv4 address of the adapter connected to the same LAN as the Mac mini. Prefer a DHCP reservation in the router so this address does not change.

## 2. Create local TLS certificates

From the repository root, run:

```powershell
Copy-Item .env.example .env
.scripts\generate-lan-certificate.ps1 -ServerIp "192.168.0.10"
```

Replace the example IP with the laptop's actual LAN IPv4 address. The script creates a private local certificate authority and a server certificate containing both the IP address and the DNS name `ndiview.home.arpa`.

Do not share or commit `certs/ca.key` or `certs/server.key`. The Compose deployment mounts only the server certificate, server key, and public CA certificate.

## 3. Make the local DNS name resolve

For a quick test, add this line to the Windows hosts file, opened as Administrator:

```text
192.168.0.10 ndiview.home.arpa
```

Add the same mapping on the Debian receiver in `/etc/hosts`, replacing the example IP with the laptop's actual LAN IP:

```text
192.168.0.10 ndiview.home.arpa
```

A DHCP reservation plus a router DNS record is preferable for a longer-lived installation.

## 4. Trust the local CA

On Windows, import `certs/ca.crt` into **Local Computer > Trusted Root Certification Authorities**. Use the Microsoft certificate import wizard; do not import the private CA key.

On the Debian receiver, copy `certs/ca.crt` from the laptop (run this in PowerShell from the repository root, replacing the SSH user/IP if needed):

```powershell
scp .\\certs\\ca.crt <receiver-user>@<receiver-ip>:/home/<receiver-user>/ndiview-ca.crt
```

Then, in the Mac mini SSH session, install it:

```bash
sudo install -m 0644 ~/ndiview-ca.crt /usr/local/share/ca-certificates/ndiview-local-ca.crt
sudo update-ca-certificates
```

Alternatively, configure the receiver's `controlPlane.caCertificatePath` to a PEM copy of this public CA certificate. Never disable TLS verification.

## 5. Build and start

Open PowerShell in the repository root:

```powershell
docker compose config
docker compose up --build -d
docker compose ps
docker compose logs -f ndiview
```

The first startup generates a one-time administrator setup key. Read it from the server logs:

```powershell
docker compose logs ndiview
```

Open:

```text
https://ndiview.home.arpa:8787
```

The browser should show a trusted HTTPS connection after the local CA has been imported and the hosts/DNS entry is in place. Use the one-time setup key shown in the server logs to create the first administrator account.

The API health endpoint is:

```text
https://ndiview.home.arpa:8787/api/v1/health
```

The Compose health check verifies this endpoint using the mounted CA certificate and the configured TLS DNS name.

## 6. Pair the Mac mini receiver

In the dashboard, create a one-time receiver pairing code. On the Mac mini, configure `/etc/ndiview/config.json`:

- `controlPlane.serverUrl`: `https://ndiview.home.arpa:8787`
- `controlPlane.deviceName`: a useful display name
- `controlPlane.pairingCode`: the newly generated 12-digit code
- `controlPlane.caCertificatePath`: leave empty if the CA was installed in the Debian system trust store, or point it at the installed CA PEM file

Pairing and heartbeat traffic uses HTTPS. The NDI video stream remains direct from the sender to the Mac mini.

## Persistent data and lifecycle

The named volume `ndiview_data` persists the database, setup/pairing secrets, and uploaded media across container recreation and image rebuilds. Do not use `docker compose down -v` unless you intentionally want to delete all NDIView data.

Useful commands:

```powershell
docker compose ps
docker compose logs -f ndiview
docker compose restart ndiview
docker compose down
docker compose up -d
```

Back up the volume before moving the server or making major changes. The local CA private key is separate from the Docker volume and must be backed up securely.

## Windows firewall and LAN access

Allow inbound TCP port 8787 on the Windows **Private** network profile if Windows Firewall blocks other LAN devices. Do not expose this temporary development server to the public internet or configure router port forwarding.

If the dashboard works on the laptop but not from the Mac mini, check the laptop's LAN IP, the hosts/DNS mapping, Windows firewall, and that both devices are on the same reachable LAN.

## Current limitations

- This is a temporary single-host deployment, not a hardened public internet deployment.
- Docker Desktop and the laptop must remain running for server-side management and receiver synchronization. Existing receiver playback and cached fallback are designed to continue when the server is offline.
- This does not implement automatic native receiver updates.
- The official NDI SDK license still needs confirmation for commercial use as a dedicated receiver appliance.
