#!/usr/bin/env bash
set -Eeuo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TEMP="$(mktemp -d)"
trap 'rm -rf "$TEMP"' EXIT
mkdir -p "$TEMP/bin" "$TEMP/output"
printf '#!/bin/sh\necho fake-ndiview\n' > "$TEMP/bin/ndiview"
chmod 0755 "$TEMP/bin/ndiview"
openssl genpkey -algorithm ED25519 -out "$TEMP/private.pem" >/dev/null 2>&1
openssl pkey -in "$TEMP/private.pem" -pubout -out "$TEMP/public.pem" >/dev/null 2>&1
NDIVIEW_BINARY="$TEMP/bin/ndiview" \
NDIVIEW_RELEASE_SIGNING_KEY="$TEMP/private.pem" \
NDIVIEW_RELEASE_VERIFY_KEY="$TEMP/public.pem" \
NDIVIEW_RELEASE_KEY_ID="test-key" \
bash "$ROOT/scripts/package-receiver-release.sh" "0.0.1-test" "$TEMP/output" development
MANIFEST="$TEMP/output/ndiview-0.0.1-test-linux-x86_64.manifest.json"
SIGNATURE="$MANIFEST.sig"
ARCHIVE="$TEMP/output/ndiview-0.0.1-test-linux-x86_64.tar.gz"
openssl pkeyutl -verify -rawin -pubin -inkey "$TEMP/public.pem" -sigfile "$SIGNATURE" -in "$MANIFEST" >/dev/null
python3 - "$MANIFEST" "$ARCHIVE" <<'PY'
import hashlib
import json
import sys
manifest_path, archive_path = sys.argv[1:]
with open(manifest_path, encoding="utf-8") as stream:
    manifest = json.load(stream)
with open(archive_path, "rb") as stream:
    archive = stream.read()
assert manifest["product"] == "NDIView"
assert manifest["releaseVersion"] == "0.0.1-test"
assert manifest["platform"] == "linux-x86_64"
assert manifest["artifactSha256"] == hashlib.sha256(archive).hexdigest()
assert manifest["artifactSizeBytes"] == len(archive)
assert manifest["signingKeyId"] == "test-key"
PY
tar -tzf "$ARCHIVE" | grep -Eq '^\./bin/ndiview$'
NDIVIEW_RELEASE_VERIFY_KEY="$TEMP/public.pem" \
NDIVIEW_RECEIVER_RELEASES_DIR="$TEMP/store" \
bash "$ROOT/scripts/publish-receiver-release.sh" "$ARCHIVE" "$MANIFEST" "$SIGNATURE"
cmp "$ARCHIVE" "$TEMP/store/0.0.1-test/linux-x86_64/artifact.tar.gz"
cmp "$MANIFEST" "$TEMP/store/0.0.1-test/linux-x86_64/manifest.json"
if NDIVIEW_RELEASE_VERIFY_KEY="$TEMP/public.pem" NDIVIEW_RECEIVER_RELEASES_DIR="$TEMP/store" bash "$ROOT/scripts/publish-receiver-release.sh" "$ARCHIVE" "$MANIFEST" "$SIGNATURE"; then
  echo "Publisher accepted a duplicate immutable release." >&2
  exit 1
fi
echo "Receiver release packaging and publication test passed."
