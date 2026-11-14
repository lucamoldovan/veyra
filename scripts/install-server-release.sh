#!/usr/bin/env bash
set -Eeuo pipefail
if [[ "$#" -ne 6 ]]; then
  echo "Usage: sudo scripts/install-server-release.sh ARCHIVE SHA256 SIGNATURE VERSION HEALTH_URL CA_BUNDLE" >&2
  exit 2
fi
ARCHIVE="$(realpath "$1")"
EXPECTED_SHA="$2"
SIGNATURE="$(realpath "$3")"
VERSION="$4"
HEALTH_URL="$5"
CA_BUNDLE="$(realpath "$6")"
if [[ "$EUID" -ne 0 ]]; then echo "Run with sudo." >&2; exit 1; fi
. /etc/os-release
if [[ "${ID:-}" != debian || "${VERSION_ID:-}" != 13 ]]; then echo "Debian 13 is required." >&2; exit 1; fi
if [[ ! "$VERSION" =~ ^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$ || ! "$EXPECTED_SHA" =~ ^[a-fA-F0-9]{64}$ ]]; then
  echo "Invalid version or SHA-256 value." >&2; exit 2
fi
for command in node npm tar openssl sha256sum curl python3; do command -v "$command" >/dev/null || { echo "Missing required command: $command" >&2; exit 1; }; done
NODE_MAJOR="$(node -p 'Number(process.versions.node.split(".")[0])')"
if (( NODE_MAJOR < 22 )); then echo "Node.js 22 or newer is required." >&2; exit 1; fi
if [[ ! -f /etc/veyra/release-signing.pub ]]; then
  echo "Install the trusted Ed25519 public key at /etc/veyra/release-signing.pub first." >&2; exit 1
fi
[[ -f "$ARCHIVE" && -f "$SIGNATURE" && -f "$CA_BUNDLE" ]] || { echo "Archive, signature or CA bundle is missing." >&2; exit 1; }
printf '%s  %s\n' "$EXPECTED_SHA" "$ARCHIVE" | sha256sum --check --status || { echo "Release SHA-256 mismatch." >&2; exit 1; }
openssl pkeyutl -verify -rawin -pubin -inkey /etc/veyra/release-signing.pub -sigfile "$SIGNATURE" -in "$ARCHIVE" >/dev/null
PREFIX="ndiview-$VERSION/"
python3 - "$ARCHIVE" "$PREFIX" <<'PY'
import pathlib
import sys
import tarfile

archive, prefix = sys.argv[1:]
prefix = prefix.rstrip("/")
seen = set()
with tarfile.open(archive, "r:gz") as bundle:
    members = bundle.getmembers()
    if not members:
        raise SystemExit("Release archive is empty")
    for member in members:
        name = member.name.rstrip("/")
        path = pathlib.PurePosixPath(name)
        if path.is_absolute() or ".." in path.parts or not (name == prefix or name.startswith(prefix + "/")):
            raise SystemExit(f"Unsafe or unexpected release path: {member.name}")
        if name in seen:
            raise SystemExit(f"Duplicate release archive entry: {member.name}")
        seen.add(name)
        if member.issym() or member.islnk() or member.isdev() or member.isfifo():
            raise SystemExit(f"Unsupported release archive entry: {member.name}")
        if not (member.isfile() or member.isdir()):
            raise SystemExit(f"Unsupported release archive entry: {member.name}")
        if member.mode & 0o6000:
            raise SystemExit(f"Setuid/setgid entry is not allowed: {member.name}")
PY

BASE=/opt/veyra
RELEASES="$BASE/releases"
DATA=/var/lib/veyra/server
ENV_FILE=/etc/veyra/server.env
UNIT=/etc/systemd/system/veyra-server.service
mkdir -p /etc/veyra "$RELEASES" "$DATA/data" "$DATA/media" "$DATA/secrets" /var/backups/veyra
if ! id veyra-server >/dev/null 2>&1; then
  useradd --system --home-dir "$DATA" --shell /usr/sbin/nologin --user-group veyra-server
fi
if [[ ! -f "$ENV_FILE" ]]; then
  install -m 0640 config/server.env.example "$ENV_FILE"
  chown root:veyra-server "$ENV_FILE"
  echo "Created $ENV_FILE. Configure TLS certificate/key paths and run this command again." >&2
  exit 1
fi
CERT_PATH="$(sed -n 's/^NDIVIEW_TLS_CERT_PATH=//p' "$ENV_FILE" | tail -n 1)"
if [[ -z "$CERT_PATH" ]]; then CERT_PATH="$(sed -n 's/^VEYRA_TLS_CERT_PATH=//p' "$ENV_FILE" | tail -n 1)"; fi
KEY_PATH="$(sed -n 's/^NDIVIEW_TLS_KEY_PATH=//p' "$ENV_FILE" | tail -n 1)"
if [[ -z "$KEY_PATH" ]]; then KEY_PATH="$(sed -n 's/^VEYRA_TLS_KEY_PATH=//p' "$ENV_FILE" | tail -n 1)"; fi
if [[ -z "$CERT_PATH" || -z "$KEY_PATH" || ! -f "$CERT_PATH" || ! -f "$KEY_PATH" ]]; then
  echo "server.env must point to existing TLS certificate and private-key files." >&2; exit 1
fi
chown root:veyra-server "$ENV_FILE"
chmod 0640 "$ENV_FILE"
chown -R veyra-server:veyra-server "$DATA"
install -m 0644 systemd/ndiview-server.service "$UNIT"
systemctl daemon-reload
systemctl enable veyra-server.service

RELEASE="$RELEASES/$VERSION"
if [[ -e "$RELEASE" ]]; then echo "Release $VERSION already exists; versions are immutable." >&2; exit 1; fi
STAGE="$RELEASES/.staging-$VERSION-$$"
mkdir -m 0755 "$STAGE"
cleanup() { rm -rf "$STAGE"; }
trap cleanup EXIT
tar -xzf "$ARCHIVE" --strip-components=1 --no-same-owner --no-same-permissions -C "$STAGE"
npm --prefix "$STAGE/server" ci --no-audit --no-fund
npm --prefix "$STAGE/server" run build
npm --prefix "$STAGE/server" prune --omit=dev
npm --prefix "$STAGE/dashboard" ci --no-audit --no-fund
npm --prefix "$STAGE/dashboard" run build
[[ -f "$STAGE/dashboard/dist/index.html" && -f "$STAGE/server/dist/index.js" ]] || { echo "Release build output is incomplete." >&2; exit 1; }
chown -R root:root "$STAGE"
chmod -R go-w "$STAGE"
mv "$STAGE" "$RELEASE"
trap - EXIT

OLD_TARGET="$(readlink -f "$BASE/current" 2>/dev/null || true)"
if systemctl is-active --quiet veyra-server.service; then systemctl stop veyra-server.service; fi
BACKUP="/var/backups/veyra/$(date -u +%Y%m%dT%H%M%SZ)-pre-$VERSION"
mkdir -m 0700 "$BACKUP"
if [[ -d "$DATA" ]]; then cp -a "$DATA/." "$BACKUP/"; fi
ln -s "$RELEASE" "$BASE/current.next"
mv -Tf "$BASE/current.next" "$BASE/current"
systemctl restart veyra-server.service || true

HEALTHY=0
for attempt in $(seq 1 20); do
  if curl --fail --silent --show-error --max-time 5 --cacert "$CA_BUNDLE" "$HEALTH_URL" -o /tmp/ndiview-health.json &&
     grep -q '"status":"ok"' /tmp/ndiview-health.json; then HEALTHY=1; break; fi
  sleep 3
done
rm -f /tmp/ndiview-health.json
if [[ "$HEALTHY" -ne 1 ]]; then
  echo "New server release failed its health check; rolling back." >&2
  systemctl stop veyra-server.service || true
  if [[ -n "$OLD_TARGET" && -d "$OLD_TARGET" ]]; then
    ln -s "$OLD_TARGET" "$BASE/current.rollback"
    mv -Tf "$BASE/current.rollback" "$BASE/current"
    systemctl start veyra-server.service || true
  else
    rm -f "$BASE/current"
  fi
  exit 1
fi
echo "NDIView server and dashboard release $VERSION is healthy."
echo "Previous release retained at: ${OLD_TARGET:-none}"
echo "Persistent data and pre-update backup: $BACKUP"
