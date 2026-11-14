#!/usr/bin/env bash
set -Eeuo pipefail
if [[ "$#" -ne 3 || "$EUID" -ne 0 ]]; then
  echo "Usage: sudo scripts/rollback-server-release.sh VERSION HEALTH_URL CA_BUNDLE" >&2
  exit 2
fi
VERSION="$1"; HEALTH_URL="$2"; CA_BUNDLE="$(realpath "$3")"
if [[ ! "$VERSION" =~ ^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$ || ! -d "/opt/veyra/releases/$VERSION" ]]; then
  echo "Requested release does not exist." >&2; exit 1
fi
BASE=/opt/veyra
OLD_TARGET="$(readlink -f "$BASE/current" 2>/dev/null || true)"
systemctl stop veyra-server.service || true
ln -s "/opt/veyra/releases/$VERSION" "$BASE/current.rollback"
mv -Tf "$BASE/current.rollback" "$BASE/current"
systemctl start veyra-server.service
for attempt in $(seq 1 20); do
  if curl --fail --silent --show-error --max-time 5 --cacert "$CA_BUNDLE" "$HEALTH_URL" -o /tmp/ndiview-health.json &&
     grep -q '"status":"ok"' /tmp/ndiview-health.json; then
    rm -f /tmp/ndiview-health.json
    echo "Rolled back to $VERSION and health check passed."
    exit 0
  fi
  sleep 3
done
rm -f /tmp/ndiview-health.json
echo "Requested rollback failed; restoring previous active release." >&2
systemctl stop veyra-server.service || true
if [[ -n "$OLD_TARGET" && -d "$OLD_TARGET" ]]; then
  ln -s "$OLD_TARGET" "$BASE/current.rollback"
  mv -Tf "$BASE/current.rollback" "$BASE/current"
  systemctl start veyra-server.service || true
fi
exit 1
