#!/usr/bin/env bash
set -Eeuo pipefail

if [[ "$#" -ne 3 ]]; then
  echo "Usage: bash scripts/publish-receiver-release.sh ARCHIVE MANIFEST SIGNATURE" >&2
  exit 2
fi
ARCHIVE="$(realpath "$1")"
MANIFEST="$(realpath "$2")"
SIGNATURE="$(realpath "$3")"
PUBLIC_KEY="${NDIVIEW_RELEASE_VERIFY_KEY:-/etc/ndiview/receiver-release-signing.pub}"
STORE_ROOT="${NDIVIEW_RECEIVER_RELEASES_DIR:-/var/lib/veyra/server/receiver-releases}"
MAX_ARTIFACT_BYTES="${NDIVIEW_MAX_RECEIVER_ARTIFACT_BYTES:-104857600}"
if [[ ! "$MAX_ARTIFACT_BYTES" =~ ^[0-9]+$ ]]; then echo "Invalid maximum receiver artifact size." >&2; exit 2; fi

for file in "$ARCHIVE" "$MANIFEST" "$SIGNATURE" "$PUBLIC_KEY"; do
  [[ -f "$file" && ! -L "$file" ]] || { echo "Required release input is missing or is not a regular file: $file" >&2; exit 1; }
done
for command in openssl sha256sum wc python3 tar; do
  command -v "$command" >/dev/null || { echo "Missing required command: $command" >&2; exit 1; }
done

openssl pkeyutl -verify -rawin -pubin -inkey "$PUBLIC_KEY" -sigfile "$SIGNATURE" -in "$MANIFEST" >/dev/null

export MAX_ARTIFACT_BYTES
mapfile -t META < <(python3 - "$MANIFEST" "$ARCHIVE" <<'PY'
import json
import os
import re
import sys
manifest_path, archive_path = sys.argv[1:]
with open(manifest_path, encoding="utf-8") as stream:
    value = json.load(stream)
version = value.get("releaseVersion", "")
platform = value.get("platform", "")
if value.get("product") != "NDIView":
    raise SystemExit("Manifest product must be NDIView")
if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9.+_-]{0,63}", version):
    raise SystemExit("Invalid release version")
if platform != "linux-x86_64" or value.get("architecture") != "x86_64":
    raise SystemExit("Unsupported receiver platform")
if value.get("channel") not in ("development", "stable"):
    raise SystemExit("Invalid release channel")
if value.get("artifactFile") != os.path.basename(archive_path):
    raise SystemExit("Artifact filename does not match the signed manifest")
if not re.fullmatch(r"[a-fA-F0-9]{64}", value.get("artifactSha256", "")):
    raise SystemExit("Invalid artifact SHA-256")
if not isinstance(value.get("artifactSizeBytes"), int) or value["artifactSizeBytes"] <= 0:
    raise SystemExit("Invalid artifact size")
if value["artifactSizeBytes"] > int(os.environ.get("MAX_ARTIFACT_BYTES", "104857600")):
    raise SystemExit("Receiver artifact exceeds the configured size limit")
if not isinstance(value.get("configSchemaVersion"), int) or value["configSchemaVersion"] < 1:
    raise SystemExit("Invalid config schema version")
print(version)
print(platform)
print(value["artifactSha256"].lower())
print(value["artifactSizeBytes"])
PY
)
VERSION="${META[0]}"
PLATFORM="${META[1]}"
EXPECTED_SHA="${META[2]}"
EXPECTED_SIZE="${META[3]}"
ACTUAL_SHA="$(sha256sum "$ARCHIVE" | awk '{print $1}')"
ACTUAL_SIZE="$(wc -c < "$ARCHIVE" | tr -d ' ')"
[[ "$ACTUAL_SHA" == "$EXPECTED_SHA" ]] || { echo "Artifact SHA-256 does not match signed manifest." >&2; exit 1; }
[[ "$ACTUAL_SIZE" == "$EXPECTED_SIZE" ]] || { echo "Artifact size does not match signed manifest." >&2; exit 1; }

python3 - "$ARCHIVE" <<'PY'
import pathlib
import sys
import tarfile
archive = sys.argv[1]
seen_binary = False
seen_names = set()
with tarfile.open(archive, "r:gz") as bundle:
    for member in bundle.getmembers():
        name = member.name
        while name.startswith("./"):
            name = name[2:]
        path = pathlib.PurePosixPath(name)
        if path.is_absolute() or ".." in path.parts:
            raise SystemExit(f"Unsafe archive path: {member.name}")
        normalized = str(path)
        if normalized in seen_names:
            raise SystemExit(f"Duplicate archive entry: {member.name}")
        seen_names.add(normalized)
        if member.issym() or member.islnk() or member.isdev() or member.isfifo():
            raise SystemExit(f"Unsupported archive entry type: {member.name}")
        if name in ("", "."):
            if not member.isdir():
                raise SystemExit("Archive root entry must be a directory")
        elif name == "bin":
            if not member.isdir():
                raise SystemExit("bin entry must be a directory")
        elif name == "bin/ndiview":
            if not member.isfile() or member.size <= 0 or not (member.mode & 0o111):
                raise SystemExit("bin/ndiview must be a non-empty executable regular file")
            seen_binary = True
        else:
            raise SystemExit(f"Unexpected archive entry: {member.name}")
if not seen_binary:
    raise SystemExit("Archive does not contain bin/ndiview")
PY

STORE_ROOT="$(realpath -m "$STORE_ROOT")"
mkdir -p "$STORE_ROOT"
if [[ -L "$STORE_ROOT" ]]; then
  echo "Receiver release store must not be a symlink." >&2
  exit 1
fi
VERSION_DIR="$STORE_ROOT/$VERSION"
if [[ -L "$VERSION_DIR" ]]; then
  echo "Refusing to publish through a symlinked version directory." >&2
  exit 1
fi
mkdir -p "$VERSION_DIR"
DEST="$VERSION_DIR/$PLATFORM"
if [[ -e "$DEST" || -L "$DEST" ]]; then
  echo "Receiver release already exists and is immutable: $VERSION/$PLATFORM" >&2
  exit 1
fi
STAGE="$(mktemp -d "$STORE_ROOT/.staging.XXXXXX")"
cleanup() { rm -rf "$STAGE"; }
trap cleanup EXIT
install -m 0444 "$ARCHIVE" "$STAGE/artifact.tar.gz"
install -m 0444 "$MANIFEST" "$STAGE/manifest.json"
install -m 0444 "$SIGNATURE" "$STAGE/manifest.sig"
chmod 0755 "$STAGE"
mv -T "$STAGE" "$DEST"
chmod 0555 "$DEST"
trap - EXIT
echo "Published immutable NDIView receiver release: $VERSION ($PLATFORM)"
echo "Stored at: $DEST"
