#!/bin/zsh
set -euo pipefail

cd -- "$(dirname -- "$0")"

readonly WAILS_VERSION="v3.0.0-beta.11"
readonly WAILS_PACKAGE="github.com/wailsapp/wails/v3/cmd/wails3"

for dependency in go node corepack; do
  if ! command -v "$dependency" >/dev/null 2>&1; then
    print -u2 "Flashnote development requires '$dependency' in PATH."
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

exec "$wails_bin" dev -config ./build/config.yml "$@"
