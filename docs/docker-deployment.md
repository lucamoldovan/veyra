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

Find the IPv4 address of the adapter connected to the same LAN as the Mac mini. Prefer a DHCP reservation in the router so this address does not change. The examples below use `192.168.0.10`; replace it with the laptop's actual LAN IPv4 address.

## 2. Create local TLS certificates

From the repository root, run:

```powershell
Copy-Item .env.example .env
.\scripts\generate-lan-certificate.ps1 -ServerIp "192.168.0.10"
```

The script creates a private local certificate authority with CA-signing extensions and a server certificate containing both the laptop IP address and the DNS name `ndiview.home.arpa`.

Do not share or commit `certs/ca.key` or `certs/server.key`. The Compose deployment mounts only the server certificate, server key, and public CA certificate.

## 3. Make the local DNS name resolve

On Windows, open the hosts file as Administrator:

```powershell
Start-Process notepad "$env:SystemRoot\System32\drivers\etc\hosts" -Verb RunAs
```

Add this line, using the laptop's actual LAN IP:

```text
192.168.0.10 ndiview.home.arpa
```

Add the same mapping on the Debian receiver in `/etc/hosts`:

```bash
echo "192.168.0.10 ndiview.home.arpa" | sudo tee -a /etc/hosts
```

Replace the example IP in both places. A DHCP reservation plus a router DNS record is preferable for a longer-lived installation.

## 4. Trust the local CA

In an **Administrator PowerShell** window on Windows, from the repository root, import only the public CA certificate:

```powershell
Import-Certificate -FilePath .\certs\ca.crt -CertStoreLocation Cert:\LocalMachine\Root
```

Do not import or share `ca.key`.

Copy the public CA certificate to the Mac mini from PowerShell:

```powershell
scp .\certs\ca.crt reciver1@192.168.0.56:/home/reciver1/ndiview-ca.crt
```

If the Mac mini's IP or SSH username has changed, adjust that destination. Then, in the Mac mini SSH session, install it:

```bash
sudo install -m 0644 ~/ndiview-ca.crt /usr/local/share/ca-certificates/ndiview-local-ca.crt
sudo update-ca-certificates
```

Never disable TLS verification. The receiver can use the system trust store after this step; its `controlPlane.caCertificatePath` can remain empty.

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

The container should become `healthy`. Open the dashboard:

```text
https://ndiview.home.arpa:8787
```

The browser should show a trusted HTTPS connection after the CA import and hosts/DNS setup. Use the one-time setup key from the logs to create the first administrator account. Choose a strong administrator password.

You can test the API from Windows:

```powershell
curl.exe --cacert .\certs\ca.crt https://ndiview.home.arpa:8787/api/v1/health
```

Expected response:

```json
{"status":"ok","service":"ndiview-server","version":"0.1.0"}
```

The Compose health check verifies the same endpoint using the mounted CA certificate and configured TLS DNS name.

## 6. Allow LAN access through Windows Firewall

If the Windows firewall blocks the Mac mini, run this in **Administrator PowerShell**:

```powershell
New-NetFirewallRule -DisplayName "NDIView LAN HTTPS 8787" -Direction Inbound -Action Allow -Protocol TCP -LocalPort 8787 -Profile Private
```

Keep the network profile Private. Do not expose this temporary server to the public internet or configure router port forwarding.

## 7. Verify from the Mac mini

After the container is healthy and the hosts entry and CA trust are installed, run over SSH:

```bash
getent hosts ndiview.home.arpa
curl -fsS https://ndiview.home.arpa:8787/api/v1/health
```

The first command should resolve to the Windows laptop's LAN IP; the second should return the JSON health response without a certificate warning.

## 8. Pair the Mac mini receiver

In the dashboard, create a one-time receiver pairing code. On the Mac mini, configure `/etc/ndiview/config.json`:

- `controlPlane.serverUrl`: `https://ndiview.home.arpa:8787`
- `controlPlane.deviceName`: a useful display name
- `controlPlane.pairingCode`: the newly generated 12-digit code
- `controlPlane.caCertificatePath`: leave empty because the CA is installed in the Debian system trust store, or explicitly point it at the installed CA PEM file

Pairing, heartbeat, configuration, and media synchronization use HTTPS. NDI video remains direct from each sender to its receiver; the central server does not relay or transcode NDI streams.

## Persistent data and lifecycle

The named volume `ndiview_data` persists the SQLite database, setup/pairing secrets, and uploaded media across container recreation and image rebuilds. Do not use `docker compose down -v` unless you intentionally want to delete all NDIView data.

Useful commands:

```powershell
docker compose ps
docker compose logs -f ndiview
docker compose restart ndiview
docker compose down
docker compose up -d
```

Back up the volume before moving the server or making major changes. The local CA private key is separate from the Docker volume and must be backed up securely.

## Current limitations

- This is a temporary single-host deployment, not a hardened public-internet deployment.
- Docker Desktop and the laptop must remain running for server-side management and receiver synchronization. Existing receiver playback and cached fallback are designed to continue when the server is offline.
- This does not implement automatic native receiver updates.
- The official NDI SDK license still needs confirmation for commercial use as a dedicated receiver appliance.
