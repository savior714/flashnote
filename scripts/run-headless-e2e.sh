#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

TEST_HOME="$(mktemp -d "${TMPDIR:-/tmp}/flashnote-headless-e2e.XXXXXX")"
ARTIFACT_DIR="${FLASHNOTE_E2E_ARTIFACT_DIR:-$ROOT_DIR/.artifacts/headless-e2e}"
SERVER_LOG="$ARTIFACT_DIR/server.log"
SERVER_PID=""

mkdir -p "$ARTIFACT_DIR"
: >"$SERVER_LOG"

# Wails server mode initializes runtime state before Flashnote's own app-data
# directory setup. A synthetic HOME therefore needs its standard XDG roots to
# exist up front; this keeps the test fully isolated without falling back to the
# runner/user HOME.
mkdir -p "$TEST_HOME/.config" "$TEST_HOME/.cache"

if [[ -n "${FLASHNOTE_HEADLESS_PORT:-}" ]]; then
  PORT="$FLASHNOTE_HEADLESS_PORT"
else
  PORT="$(node -e "const net=require('net');const s=net.createServer();s.listen(0,'127.0.0.1',()=>{console.log(s.address().port);s.close();});")"
fi

cleanup() {
  local exit_code=$?
  if [[ -n "$SERVER_PID" ]] && kill -0 "$SERVER_PID" 2>/dev/null; then
    kill "$SERVER_PID" 2>/dev/null || true
    wait "$SERVER_PID" 2>/dev/null || true
  fi
  if [[ $exit_code -ne 0 ]]; then
    echo "--- Wails server log ---" >&2
    cat "$SERVER_LOG" >&2 || true
  fi
  rm -rf "$TEST_HOME"
  exit "$exit_code"
}
trap cleanup EXIT INT TERM

HOME="$TEST_HOME" \
XDG_CONFIG_HOME="$TEST_HOME/.config" \
XDG_CACHE_HOME="$TEST_HOME/.cache" \
WAILS_SERVER_HOST="127.0.0.1" \
WAILS_SERVER_PORT="$PORT" \
go run -tags server . >"$SERVER_LOG" 2>&1 &
SERVER_PID=$!

ready=0
for _ in {1..120}; do
  if curl --fail --silent "http://127.0.0.1:$PORT/health" >/dev/null 2>&1; then
    ready=1
    break
  fi
  if ! kill -0 "$SERVER_PID" 2>/dev/null; then
    echo "Wails server exited before becoming ready" >&2
    exit 1
  fi
  sleep 0.25
done

if [[ $ready -ne 1 ]]; then
  echo "Timed out waiting for Wails server on port $PORT" >&2
  exit 1
fi

FLASHNOTE_E2E_BASE_URL="http://127.0.0.1:$PORT" \
corepack pnpm --dir e2e exec playwright test