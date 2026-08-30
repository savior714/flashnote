#!/bin/zsh
set -euo pipefail

cd -- "$(dirname -- "$0")"

readonly WAILS_VERSION="v3.0.0-beta.11"
readonly WAILS_PACKAGE="github.com/wailsapp/wails/v3/cmd/wails3"

for dependency in go node corepack; do
  if ! command -v "$dependency" >/dev/null 2>&1; then
    print -u2 "Flashnote source run requires '$dependency' in PATH."
    exit 1
  fi
done

wails_bin="$(command -v wails3 || true)"
wails_version=""
if [[ -n "$wails_bin" ]]; then
  wails_version="$($wails_bin version 2>&1 || true)"
fi

if [[ "$wails_version" != "$WAILS_VERSION" ]]; then
  print "Preparing Wails $WAILS_VERSION..."
  go install "$WAILS_PACKAGE@$WAILS_VERSION"
  wails_bin="$(go env GOPATH)/bin/wails3"
fi

# This is the real personal-use launcher. Acceptance modes are test-only and
# must never leak into the normal user-data process through an inherited shell.
unset VITE_FLASHNOTE_ACCEPTANCE_TEXT VITE_FLASHNOTE_DATA_SAFETY_ACCEPTANCE

# Deliberately avoid `wails3 dev`: watch/HMR/rebuild restarts are development
# lifecycle events and can invalidate an in-memory editor draft outside the
# normal Flashnote close/transition flush path.
exec "$wails_bin" task run
