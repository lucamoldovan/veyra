#!/usr/bin/env bash
set -Eeuo pipefail
VERSION="${1:?Usage: scripts/package-server-release.sh VERSION [OUTPUT_DIR]}"
OUTPUT_DIR="${2:-dist/releases}"
if [[ ! "$VERSION" =~ ^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$ ]]; then
  echo "Invalid release version." >&2; exit 2
fi
if [[ -n "$(git status --porcelain)" ]]; then
  echo "Refusing to package a dirty working tree. Commit all intended changes first." >&2; exit 1
fi
SIGNING_KEY="${NDIVIEW_RELEASE_SIGNING_KEY:-${VEYRA_RELEASE_SIGNING_KEY:-}}"
if [[ -z "$SIGNING_KEY" ]]; then echo "Set NDIVIEW_RELEASE_SIGNING_KEY to the offline Ed25519 private-key path." >&2; exit 1; fi
if [[ ! -r "$SIGNING_KEY" ]]; then echo "Signing key is not readable." >&2; exit 1; fi
mkdir -p "$OUTPUT_DIR"
ARCHIVE="$OUTPUT_DIR/ndiview-$VERSION.tar.gz"
git archive --format=tar.gz --prefix="ndiview-$VERSION/" HEAD > "$ARCHIVE"
sha256sum "$ARCHIVE" > "$ARCHIVE.sha256"
openssl pkeyutl -sign -rawin -inkey "$SIGNING_KEY" -in "$ARCHIVE" -out "$ARCHIVE.sig"
echo "Created signed release:"
echo "  $ARCHIVE"
echo "  $ARCHIVE.sha256"
echo "  $ARCHIVE.sig"
