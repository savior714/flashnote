#!/usr/bin/env bash
#
# Builds the Windows release artifacts for Flashnote:
#
#   bin/flashnote-amd64.exe                    portable 64-bit executable
#   bin/flashnote-arm64.exe                    portable ARM64 executable
#   bin/Flashnote-<version>-windows-setup.exe  one NSIS installer for both architectures
#
# The installer is per-user by default: it installs under %LOCALAPPDATA%\Programs,
# needs no administrator rights and no UAC prompt, and registers an uninstaller.
#
# Runs under Git Bash on Windows and, when NSIS (makensis) is installed, on
# macOS/Linux as well. Go cross-compiles the executables; only the installer
# needs makensis, so SKIP_INSTALLER=1 produces just the portable binaries.
#
# Usage:
#   VERSION=0.2.0 bash scripts/package-windows-release.sh
#   VERSION=0.2.0 INSTALL_SCOPE=machine bash scripts/package-windows-release.sh
#   VERSION=0.2.0 SKIP_INSTALLER=1 bash scripts/package-windows-release.sh
set -euo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel)"
cd "$REPO_ROOT"

APP_NAME="flashnote"
BIN_DIR="bin"
VERSION="${VERSION:-0.1.0}"
INSTALL_SCOPE="${INSTALL_SCOPE:-user}"
SKIP_INSTALLER="${SKIP_INSTALLER:-0}"
ARCHES="${ARCHES:-amd64 arm64}"

if ! printf '%s' "$VERSION" | grep -Eq '^[0-9]+\.[0-9]+\.[0-9]+$'; then
  echo "VERSION must be a numeric x.y.z release version, got '$VERSION'." >&2
  exit 1
fi

case "$INSTALL_SCOPE" in
  user | machine) ;;
  *)
    echo "INSTALL_SCOPE must be 'user' or 'machine', got '$INSTALL_SCOPE'." >&2
    exit 1
    ;;
esac

require() {
  command -v "$1" >/dev/null 2>&1 || {
    echo "Windows release packaging requires '$1' in PATH." >&2
    exit 1
  }
}

for tool in go node corepack wails3 git; do
  require "$tool"
done

if [[ "$SKIP_INSTALLER" != "1" ]]; then
  require makensis
fi

# Rewrites a POSIX path into a form the Windows tooling accepts. Under Git Bash
# makensis receives an MSYS path unless it is converted back to a Windows one.
native_path() {
  if command -v cygpath >/dev/null 2>&1; then
    cygpath -w "$1"
  else
    printf '%s' "$1"
  fi
}

PATH_SEP="/"
if command -v cygpath >/dev/null 2>&1 && [[ "$(native_path "$PWD")" == *\\* ]]; then
  PATH_SEP="\\"
fi

echo "==> Building the production frontend (embedded by go:embed)"
wails3 task frontend:build

echo "==> Generating the Windows icon and the macOS bundle icon"
mkdir -p "$BIN_DIR" build/windows build/darwin
cp assets/appicon.png build/appicon.png
wails3 generate icons \
  -input build/appicon.png \
  -macfilename build/darwin/icons.icns \
  -windowsfilename build/windows/icon.ico

built_arches=()
for arch in $ARCHES; do
  echo "==> Building windows/$arch"
  syso="wails_windows_${arch}.syso"
  wails3 generate syso \
    -arch "$arch" \
    -icon build/windows/icon.ico \
    -manifest build/windows/wails.exe.manifest \
    -info build/windows/info.json \
    -out "$syso"
  # -H windowsgui keeps the executable a windowed app: without it Windows opens
  # a console window behind the app for the whole session.
  GOOS=windows GOARCH="$arch" CGO_ENABLED=0 go build \
    -tags production -trimpath -buildvcs=false \
    -ldflags="-w -s -H windowsgui" \
    -o "$BIN_DIR/$APP_NAME-$arch.exe" .
  rm -f "$syso"
  built_arches+=("$arch")
  echo "    $BIN_DIR/$APP_NAME-$arch.exe"
done

INSTALLER=""
if [[ "$SKIP_INSTALLER" != "1" ]]; then
  echo "==> Building the NSIS installer (scope: $INSTALL_SCOPE)"
  nsis_dir="build/windows/nsis"
  # Writes the WebView2 bootstrapper that wails_tools.nsh embeds (it is shipped
  # inside the wails3 binary, so this needs no network). The installer runs it
  # only when the machine has no WebView2 runtime yet.
  wails3 generate webview2bootstrapper -dir "$nsis_dir"

  bin_native="$(native_path "$REPO_ROOT/$BIN_DIR")"
  makensis_args=(
    "-DWAILS_INSTALL_SCOPE=$INSTALL_SCOPE"
    "-DREQUEST_EXECUTION_LEVEL=$INSTALL_SCOPE"
    "-DINFO_PRODUCTVERSION=$VERSION"
  )
  for arch in "${built_arches[@]}"; do
    case "$arch" in
      amd64) makensis_args+=("-DARG_WAILS_AMD64_BINARY=${bin_native}${PATH_SEP}$APP_NAME-amd64.exe") ;;
      arm64) makensis_args+=("-DARG_WAILS_ARM64_BINARY=${bin_native}${PATH_SEP}$APP_NAME-arm64.exe") ;;
      *)
        echo "Unsupported architecture for the installer: $arch" >&2
        exit 1
        ;;
    esac
  done

  (
    cd "$nsis_dir"
    makensis "${makensis_args[@]}" project.nsi
  )

  raw_installer="$(ls "$BIN_DIR"/"$APP_NAME"-*-installer.exe | head -n 1)"
  INSTALLER="$BIN_DIR/Flashnote-$VERSION-windows-setup.exe"
  mv "$raw_installer" "$INSTALLER"
  echo "    $INSTALLER"
fi

echo
echo "Windows release artifacts:"
for arch in "${built_arches[@]}"; do
  echo "  EXE=$BIN_DIR/$APP_NAME-$arch.exe"
done
if [[ -n "$INSTALLER" ]]; then
  echo "  INSTALLER=$INSTALLER"
fi
echo "VERSION=$VERSION"
