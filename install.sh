#!/bin/bash
# Installs (or updates) Onshape Link on macOS from the latest GitHub release.
#
#   curl -fsSL https://raw.githubusercontent.com/RyanDennis916/onshape-link/main/install.sh | bash
#
# Why this exists: builds aren't notarized by Apple yet, so a .dmg downloaded
# in a browser gets quarantined and Gatekeeper blocks the app on first open.
# Files fetched with curl aren't quarantined, so installing this way skips
# that prompt. Re-run the same command to update.
set -euo pipefail

REPO="RyanDennis916/onshape-link"
APP_NAME="Onshape Link"
INSTALL_DIR="/Applications"

fail() {
  echo "Error: $*" >&2
  exit 1
}

[[ "$(uname -s)" == "Darwin" ]] || fail "this installer is for macOS only."

case "$(uname -m)" in
  arm64) ARCH="arm64" ;;
  x86_64) ARCH="x64" ;;
  *) fail "unsupported Mac architecture: $(uname -m)" ;;
esac

echo "Finding the latest ${APP_NAME} release..."
release_json="$(curl -fsSL -H "Accept: application/vnd.github+json" "https://api.github.com/repos/${REPO}/releases/latest")" \
  || fail "could not reach GitHub. Check your internet connection and try again."

dmg_urls="$(printf '%s\n' "$release_json" | grep -o '"browser_download_url": *"[^"]*\.dmg"' | sed 's/.*"\(https[^"]*\)"/\1/')"

# Prefer the build for this Mac's architecture; fall back to a universal /
# un-suffixed build if one is published.
dmg_url="$(printf '%s\n' "$dmg_urls" | grep -- "-${ARCH}\.dmg$" | head -n 1 || true)"
if [[ -z "$dmg_url" ]]; then
  dmg_url="$(printf '%s\n' "$dmg_urls" | grep -v -- '-arm64\.dmg$' | grep -v -- '-x64\.dmg$' | head -n 1 || true)"
fi
if [[ -z "$dmg_url" ]]; then
  if [[ "$ARCH" == "x64" ]]; then
    fail "the latest release has no build for Intel Macs yet (only Apple Silicon)."
  fi
  fail "could not find a macOS download in the latest release."
fi

work_dir="$(mktemp -d)"
mount_point="${work_dir}/mnt"
cleanup() {
  hdiutil detach "$mount_point" -quiet >/dev/null 2>&1 || true
  rm -rf "$work_dir"
}
trap cleanup EXIT

echo "Downloading $(basename "$dmg_url")..."
curl -fL --progress-bar -o "${work_dir}/app.dmg" "$dmg_url" || fail "download failed."

mkdir -p "$mount_point"
hdiutil attach "${work_dir}/app.dmg" -nobrowse -readonly -mountpoint "$mount_point" -quiet \
  || fail "could not open the downloaded disk image."

src_app="${mount_point}/${APP_NAME}.app"
[[ -d "$src_app" ]] || fail "the disk image does not contain ${APP_NAME}.app."

dest_app="${INSTALL_DIR}/${APP_NAME}.app"

# Quit a running copy so it can be replaced.
if pgrep -x "$APP_NAME" >/dev/null 2>&1; then
  echo "Quitting the running ${APP_NAME}..."
  osascript -e "quit app \"${APP_NAME}\"" >/dev/null 2>&1 || true
  for _ in 1 2 3 4 5 6 7 8 9 10; do
    pgrep -x "$APP_NAME" >/dev/null 2>&1 || break
    sleep 0.5
  done
  pkill -x "$APP_NAME" >/dev/null 2>&1 || true
fi

SUDO=""
if [[ ! -w "$INSTALL_DIR" ]] || { [[ -e "$dest_app" ]] && [[ ! -w "$dest_app" ]]; }; then
  echo "Administrator permission is needed to install into ${INSTALL_DIR}."
  SUDO="sudo"
fi

echo "Installing to ${dest_app}..."
$SUDO rm -rf "$dest_app"
$SUDO ditto "$src_app" "$dest_app"
$SUDO xattr -dr com.apple.quarantine "$dest_app" 2>/dev/null || true

echo "Done. Launching ${APP_NAME} - look for its icon in the menu bar."
open "$dest_app"
