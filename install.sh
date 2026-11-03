#!/bin/sh
# RoleCall Node-free bootstrap (ADR 0023).
#
#   curl -fsSL https://raw.githubusercontent.com/markporter/rolecall/main/install.sh | sh -s -- --user
#
# Downloads the platform binary + SHA256SUMS from GitHub Releases, verifies the
# checksum, then runs `<binary> install --from-dir ...` so all layout/config/
# service policy stays in tested TypeScript.
set -eu

REPO="${ROLECALL_REPO:-markporter/rolecall}"
API="https://api.github.com/repos/$REPO/releases"
TAG=""
FROM_DIR=""
INSTALL_ARGS=""
SCOPE_ARG=""
NO_SERVICE=""
YES=""

usage() {
  cat <<'USAGE'
Usage: install.sh [options]
  --system|--user          install scope (default: root -> system, else user)
  --prefix DIR             program directory override
  --config-dir DIR         config directory override
  --state-dir DIR          state directory override
  --no-service             skip service unit generation
  --yes                    apply without an install prompt
  --dry-run                plan only
  --version TAG            release tag (default: latest GitHub release)
  --from-dir DIR           install from a pre-downloaded artifact directory
  -h, --help               this help
USAGE
}

while [ $# -gt 0 ]; do
  case "$1" in
    --system|--user) SCOPE_ARG="$1" ;;
    --prefix|--config-dir|--state-dir)
      [ $# -ge 2 ] || { echo "install: $1 needs a value" >&2; exit 2; }
      INSTALL_ARGS="$INSTALL_ARGS $1 $2"; shift ;;
    --no-service) NO_SERVICE="--no-service" ;;
    --yes|-y) YES="--yes" ;;
    --dry-run) INSTALL_ARGS="$INSTALL_ARGS --dry-run" ;;
    --version)
      [ $# -ge 2 ] || { echo "install: --version needs a tag" >&2; exit 2; }
      TAG="$2"; shift ;;
    --from-dir)
      [ $# -ge 2 ] || { echo "install: --from-dir needs a directory" >&2; exit 2; }
      FROM_DIR="$2"; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "install: unknown option '$1'" >&2; exit 2 ;;
  esac
  shift
done

have() { command -v "$1" >/dev/null 2>&1; }
fetch() {
  if have curl; then curl -fsSL "$1"; else wget -qO- "$1"; fi
}
download() {
  if have curl; then curl -fsSL "$1" -o "$2"; else wget -q "$1" -O "$2"; fi
}
sha256() {
  if have sha256sum; then sha256sum "$1" | awk '{print $1}';
  elif have shasum; then shasum -a 256 "$1" | awk '{print $1}';
  elif have openssl; then openssl dgst -sha256 "$1" | awk '{print $NF}';
  else echo "install: no SHA-256 tool available" >&2; exit 1; fi
}

if [ -n "$FROM_DIR" ]; then
  BIN="$FROM_DIR/rolecall"
  [ -x "$BIN" ] || { echo "install: $BIN is not executable" >&2; exit 1; }
  exec "$BIN" install --from-dir "$FROM_DIR" $SCOPE_ARG $NO_SERVICE $YES $INSTALL_ARGS
fi

case "$(uname -s)" in
  Linux*) OS=linux ;;
  Darwin*) OS=darwin ;;
  *) echo "install: unsupported OS $(uname -s)" >&2; exit 1 ;;
esac
case "$(uname -m)" in
  x86_64|amd64) ARCH=x64 ;;
  arm64|aarch64) ARCH=arm64 ;;
  *) echo "install: unsupported architecture $(uname -m)" >&2; exit 1 ;;
esac
case "$OS-$ARCH" in
  linux-x64) TARGET=linux-x64-musl ;;
  linux-arm64) TARGET=linux-arm64-musl ;;
  darwin-arm64) TARGET=darwin-arm64-musl ;;
  *) echo "install: no prebuilt artifact for $OS-$ARCH" >&2; exit 1 ;;
esac

if [ -z "$TAG" ]; then
  # Pre-beta single stream: the newest published non-draft release.
  TAG="$(fetch "$API?per_page=10" | grep -m1 -o '"tag_name": *"[^"]*"' | sed 's/.*"tag_name": *"//;s/"$//')"
  [ -n "$TAG" ] || { echo "install: could not resolve the latest GitHub release" >&2; exit 1; }
fi

BASE="https://github.com/$REPO/releases/download/$TAG"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT INT TERM
STAGE="$TMP/stage"
mkdir -p "$STAGE"
echo "install: fetching $REPO $TAG ($TARGET)"
download "$BASE/rolecall-$TARGET" "$TMP/rolecall"
download "$BASE/SHA256SUMS" "$TMP/SHA256SUMS"

EXPECTED="$(awk -v name="rolecall-$TARGET" '$2==name {print $1}' "$TMP/SHA256SUMS" | head -1)"
[ -n "$EXPECTED" ] || { echo "install: SHA256SUMS has no entry for rolecall-$TARGET" >&2; exit 1; }
ACTUAL="$(sha256 "$TMP/rolecall")"
[ "$EXPECTED" = "$ACTUAL" ] || { echo "install: checksum mismatch for rolecall-$TARGET" >&2; exit 1; }

cp "$TMP/rolecall" "$STAGE/rolecall"
chmod 755 "$STAGE/rolecall"
printf '%s\n' "${TAG#v}" > "$STAGE/version.txt"
printf '%s  rolecall\n' "$ACTUAL" > "$STAGE/SHA256SUMS"

exec "$STAGE/rolecall" install --from-dir "$STAGE" $SCOPE_ARG $NO_SERVICE $YES $INSTALL_ARGS
