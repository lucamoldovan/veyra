#!/usr/bin/env bash
set -Eeuo pipefail

VERSION="${1:?Usage: bash scripts/package-receiver-release.sh VERSION [OUTPUT_DIR] [CHANNEL]}"
OUTPUT_DIR="${2:-dist/receiver-releases}"
CHANNEL="${3:-development}"
BINARY="${NDIVIEW_BINARY:-build/ndiview}"

if [[ ! "${VERSION}" =~ ^[0-9A-Za-z][0-9A-Za-z.+_-]{0,63}$ ]]; then
  echo "Invalid receiver release version." >&2
  exit 2
fi
if [[ "${CHANNEL}" != "development" && "${CHANNEL}" != "stable" ]]; then
  echo "Channel must be development or stable." >&2
  exit 2
fi
if [[ ! -f "${BINARY}" || ! -x "${BINARY}" ]]; then
  echo "NDIView receiver binary is missing or not executable: ${BINARY}" >&2
  exit 1
fi
: "${NDIVIEW_RELEASE_SIGNING_KEY:?Set NDIVIEW_RELEASE_SIGNING_KEY to the offline Ed25519 private-key path}"
if [[ ! -r "${NDIVIEW_RELEASE_SIGNING_KEY}" ]]; then
  echo "Release signing key is not readable." >&2
  exit 1
fi
for command in tar gzip sha256sum openssl python3; do
  command -v "${command}" >/dev/null || { echo "Missing required command: ${command}" >&2; exit 1; }
done

PLATFORM="linux-x86_64"
KEY_ID="${NDIVIEW_RELEASE_KEY_ID:-ndiview-ed25519-1}"
MIN_SERVER_VERSION="${NDIVIEW_MIN_SERVER_VERSION:-0.1.0}"
CONFIG_SCHEMA_VERSION="${NDIVIEW_CONFIG_SCHEMA_VERSION:-1}"
RELEASE_NOTES="${NDIVIEW_RELEASE_NOTES:-}"
mkdir -p "${OUTPUT_DIR}"
OUTPUT_DIR="$(cd "${OUTPUT_DIR}" && pwd)"
ARCHIVE="${OUTPUT_DIR}/ndiview-${VERSION}-${PLATFORM}.tar.gz"
MANIFEST="${OUTPUT_DIR}/ndiview-${VERSION}-${PLATFORM}.manifest.json"
SIGNATURE="${MANIFEST}.sig"
STAGE="$(mktemp -d)"
trap 'rm -rf "${STAGE}"' EXIT

mkdir -p "${STAGE}/bin"
install -m 0755 "${BINARY}" "${STAGE}/bin/ndiview"
tar --sort=name --mtime='@0' --owner=0 --group=0 --numeric-owner -C "${STAGE}" -cf - . | gzip -n > "${ARCHIVE}"

ARTIFACT_SHA256="$(sha256sum "${ARCHIVE}" | awk '{print $1}')"
ARTIFACT_SIZE="$(wc -c < "${ARCHIVE}" | tr -d ' ')"
export VERSION CHANNEL PLATFORM KEY_ID MIN_SERVER_VERSION CONFIG_SCHEMA_VERSION RELEASE_NOTES ARTIFACT_SHA256 ARTIFACT_SIZE
python3 - "${MANIFEST}" <<'PY'
import json
import os
import sys
manifest = {
    "product": "NDIView",
    "releaseVersion": os.environ["VERSION"],
    "channel": os.environ["CHANNEL"],
    "platform": os.environ["PLATFORM"],
    "architecture": "x86_64",
    "artifactFile": f"ndiview-{os.environ['VERSION']}-{os.environ['PLATFORM']}.tar.gz",
    "artifactSha256": os.environ["ARTIFACT_SHA256"],
    "artifactSizeBytes": int(os.environ["ARTIFACT_SIZE"]),
    "minimumServerVersion": os.environ["MIN_SERVER_VERSION"],
    "configSchemaVersion": int(os.environ["CONFIG_SCHEMA_VERSION"]),
    "signingKeyId": os.environ["KEY_ID"],
    "releaseNotes": os.environ["RELEASE_NOTES"],
}
with open(sys.argv[1], "w", encoding="utf-8", newline="\n") as stream:
    json.dump(manifest, stream, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    stream.write("\n")
PY

openssl pkeyutl -sign -rawin -inkey "${NDIVIEW_RELEASE_SIGNING_KEY}" -in "${MANIFEST}" -out "${SIGNATURE}"
openssl pkeyutl -verify -rawin -pubin -inkey "${NDIVIEW_RELEASE_VERIFY_KEY:?Set NDIVIEW_RELEASE_VERIFY_KEY to the matching public key for local verification}" -sigfile "${SIGNATURE}" -in "${MANIFEST}" >/dev/null

echo "Created signed NDIView receiver release:"
echo "  ${ARCHIVE}"
echo "  ${MANIFEST}"
echo "  ${SIGNATURE}"
