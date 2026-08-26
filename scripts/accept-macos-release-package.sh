#!/usr/bin/env bash
set -euo pipefail

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "macOS release package acceptance must run on macOS." >&2
  exit 1
fi

REPO_ROOT="$(git rev-parse --show-toplevel)"
cd "$REPO_ROOT"

if ! git diff --quiet || ! git diff --cached --quiet; then
  echo "Tracked worktree/index must be clean before package acceptance." >&2
  git status --short >&2
  exit 1
fi

HEAD_SHA="$(git rev-parse HEAD)"
if [[ -n "${GITHUB_SHA:-}" && "$HEAD_SHA" != "$GITHUB_SHA" ]]; then
  echo "HEAD_SHA ($HEAD_SHA) does not match GITHUB_SHA ($GITHUB_SHA)." >&2
  exit 1
fi

EVIDENCE_DIR="${FLASHNOTE_PACKAGE_EVIDENCE_DIR:-$REPO_ROOT/bin/acceptance-evidence/macos-release-package-$HEAD_SHA}"
TMP_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/flashnote-package-acceptance.XXXXXX")"
CANONICAL_CONFIG="$TMP_ROOT/build-config.yml"
TOOL_BIN="$TMP_ROOT/bin"
mkdir -p "$TOOL_BIN"
cp build/config.yml "$CANONICAL_CONFIG"

cleanup() {
  cp "$CANONICAL_CONFIG" build/config.yml 2>/dev/null || true
  git restore --source=HEAD --worktree -- frontend/bindings frontend/dist/.keep 2>/dev/null || true
  rm -rf "$TMP_ROOT"
}
trap cleanup EXIT

require_command() {
  command -v "$1" >/dev/null 2>&1 || {
    echo "Required command not found: $1" >&2
    exit 1
  }
}

for command_name in go node corepack xcode-select plutil codesign lipo ditto shasum git; do
  require_command "$command_name"
done

GO_VERSION="$(go version)"
NODE_VERSION="$(node --version)"
XCODE_PATH="$(xcode-select -p)"
printf 'Go: %s\nNode: %s\nXcode: %s\n' "$GO_VERSION" "$NODE_VERSION" "$XCODE_PATH"

[[ "$GO_VERSION" == *"go1.27.0 "* ]] || {
  echo "Go 1.27.0 is required for package acceptance." >&2
  exit 1
}
[[ "$NODE_VERSION" == v24.* ]] || {
  echo "Node 24.x is required for package acceptance." >&2
  exit 1
}

corepack enable
corepack prepare pnpm@11.21.0 --activate
PNPM_VERSION="$(pnpm --version)"
[[ "$PNPM_VERSION" == "11.21.0" ]] || {
  echo "Expected pnpm 11.21.0, got $PNPM_VERSION." >&2
  exit 1
}

GOBIN="$TOOL_BIN" go install github.com/wailsapp/wails/v3/cmd/wails3@v3.0.0-beta.11
WAILS="$TOOL_BIN/wails3"
WAILS_VERSION="$($WAILS version)"
[[ "$WAILS_VERSION" == "v3.0.0-beta.11" ]] || {
  echo "Expected Wails v3.0.0-beta.11, got $WAILS_VERSION." >&2
  exit 1
}

echo "pnpm: $PNPM_VERSION"
echo "Wails: $WAILS_VERSION"

go mod tidy
git diff --exit-code -- go.mod go.sum
(
  cd frontend
  pnpm install --frozen-lockfile
)
git diff --exit-code -- frontend/package.json frontend/pnpm-lock.yaml

"$WAILS" generate build-assets -name flashnote -dir ./build
cp "$CANONICAL_CONFIG" build/config.yml
"$WAILS" update build-assets -name flashnote -binaryname flashnote -config ./build/config.yml -dir ./build
cmp "$CANONICAL_CONFIG" build/config.yml
test -f build/Taskfile.yml
test -f build/darwin/Taskfile.yml
test -f build/darwin/Info.plist
test -f build/appicon.png
git diff --exit-code -- build/config.yml

rm -rf bin/flashnote.app bin/flashnote
"$WAILS" task --taskfile ./Taskfile.release.yml package:macos
test -d bin/flashnote.app

APP="bin/flashnote.app"
PLIST="$APP/Contents/Info.plist"
EXE="$APP/Contents/MacOS/flashnote"
ICON="$APP/Contents/Resources/icons.icns"

test -f "$PLIST"
test -x "$EXE"
test -s "$ICON"
plutil -lint "$PLIST"

config_value() {
  local key="$1"
  awk -v key="$key" '
    /^info:/ { in_info=1; next }
    in_info && /^[^[:space:]]/ { exit }
    in_info && $1 == key ":" {
      sub(/^[^:]+:[[:space:]]*/, "")
      gsub(/^"|"$/, "")
      print
      exit
    }
  ' build/config.yml
}

PRODUCT_NAME="$(config_value productName)"
PRODUCT_ID="$(config_value productIdentifier)"
PRODUCT_VERSION="$(config_value version)"
test -n "$PRODUCT_NAME"
test -n "$PRODUCT_ID"
test -n "$PRODUCT_VERSION"

plist_value() {
  /usr/libexec/PlistBuddy -c "Print :$1" "$PLIST"
}

test "$(plist_value CFBundlePackageType)" = "APPL"
test "$(plist_value CFBundleName)" = "$PRODUCT_NAME"
test "$(plist_value CFBundleExecutable)" = "flashnote"
test "$(plist_value CFBundleIdentifier)" = "$PRODUCT_ID"
test "$(plist_value CFBundleVersion)" = "$PRODUCT_VERSION"
test "$(plist_value CFBundleShortVersionString)" = "$PRODUCT_VERSION"

codesign --verify --deep --strict "$APP"
SIGNATURE_INFO="$(codesign -dv --verbose=4 "$APP" 2>&1)"
printf '%s\n' "$SIGNATURE_INFO"
grep -q 'Signature=adhoc' <<<"$SIGNATURE_INFO"

ARCHS="$(lipo -archs "$EXE")"
test -n "$ARCHS"
echo "Packaged architecture(s): $ARCHS"

rm -rf "$EVIDENCE_DIR"
mkdir -p "$EVIDENCE_DIR"
ditto -c -k --sequesterRsrc --keepParent "$APP" "$EVIDENCE_DIR/flashnote-macos-app.zip"
{
  echo "HEAD_SHA=$HEAD_SHA"
  echo "PRODUCT_NAME=$PRODUCT_NAME"
  echo "PRODUCT_IDENTIFIER=$PRODUCT_ID"
  echo "PRODUCT_VERSION=$PRODUCT_VERSION"
  echo "ARCHITECTURES=$ARCHS"
  echo "SIGNING_SCOPE=ADHOC_PACKAGE_STRUCTURE_ONLY"
  printf '%s\n' "$SIGNATURE_INFO"
} > "$EVIDENCE_DIR/bundle-metadata.txt"
(
  cd "$EVIDENCE_DIR"
  shasum -a 256 flashnote-macos-app.zip > SHA256SUMS
)

while IFS= read -r path; do
  case "$path" in
    frontend/bindings/*|frontend/dist/.keep)
      ;;
    *)
      echo "Unexpected tracked mutation from package build: $path" >&2
      git diff -- "$path" >&2 || true
      exit 1
      ;;
  esac
done < <(git diff --name-only)

git restore --source=HEAD --worktree -- frontend/bindings frontend/dist/.keep
git diff --exit-code
git diff --cached --exit-code

printf '\nRESULT: PASS\n'
echo "HEAD_SHA=$HEAD_SHA"
echo "EVIDENCE_DIR=$EVIDENCE_DIR"
cat "$EVIDENCE_DIR/bundle-metadata.txt"
cat "$EVIDENCE_DIR/SHA256SUMS"
