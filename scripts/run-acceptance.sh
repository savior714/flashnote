#!/bin/zsh
# Acceptance runner with enforced isolation.
#
# Acceptance is the only automation that mutates note data, so it must never run
# against the developer's real data directory. This script is the canonical way to
# run it: one process owns the isolated HOME from build through run, so the HOME
# that shaped the acceptance build is the HOME the acceptance process resolves.
# Losing that pairing - the failure that once pointed acceptance at real notes -
# also fails closed inside the app (frontend acceptance isolation gate), but this
# runner keeps the isolation true in the first place.
#
# Usage: scripts/run-acceptance.sh [acceptance-text]
#   acceptance-text defaults to the durable vertical slice text.
set -euo pipefail

readonly ACCEPTANCE_TEXT="${1:-Flashnote durable vertical slice}"
readonly REPO_ROOT="$(cd -- "$(dirname -- "$0")/.." && pwd)"
readonly REAL_HOME="${HOME}"
# Built from TMPDIR without an extra separator: a doubled slash would make this
# script's own path comparisons disagree with the paths the application logs.
readonly WORK_HOME="$(mktemp -d "${TMPDIR:-/tmp}flashnote-accept-home.XXXXXX")"
# Logs outlive the isolated HOME so a failure stays debuggable after cleanup.
readonly LOG_DIR="$(mktemp -d "${TMPDIR:-/tmp}flashnote-acceptance-logs.XXXXXX")"
readonly BUILD_LOG="${LOG_DIR}/acceptance-build.log"
readonly RUN_LOG="${LOG_DIR}/acceptance-run.log"
readonly DATA_SAFETY_MODE="${VITE_FLASHNOTE_DATA_SAFETY_ACCEPTANCE:-}"

# Go derives its caches from HOME. Point them at the real caches so the isolated
# HOME carries application data only, and so cleanup cannot collide with the
# read-only module cache Go creates there.
readonly GO_CACHE="$(go env GOCACHE)"
readonly GO_MODCACHE="$(go env GOMODCACHE)"

if [[ "${REAL_HOME}" == "${WORK_HOME}" ]]; then
  print -u2 "acceptance isolation: refusing to run; isolated HOME equals the current HOME (${REAL_HOME})"
  rm -rf "${WORK_HOME}"
  exit 1
fi

# The isolated HOME must be fresh: never the real one, and never a directory that
# already holds application data.
if [[ -e "${WORK_HOME}/Library/Application Support/Flashnote" ]]; then
  print -u2 "acceptance isolation: refusing to reuse a non-fresh isolated HOME"
  rm -rf "${WORK_HOME}"
  exit 1
fi
if [[ -d "${REAL_HOME}/Library/Application Support/Flashnote" ]]; then
  print "acceptance isolation: real data directory present at ${REAL_HOME}/Library/Application Support/Flashnote"
fi

# Fingerprint the real data directory so the run can prove it left it untouched.
fingerprint_real_data() {
  find "${REAL_HOME}/Library/Application Support/Flashnote" -maxdepth 2 -type f \
    \( -name 'flashnote.db*' -o -name '*.png' \) -exec md5 {} \; 2>/dev/null | sort || true
}
readonly REAL_BEFORE="${LOG_DIR}/real-data-before.md5"
fingerprint_real_data >"${REAL_BEFORE}"

cleanup() {
  local rc=$?
  # Go leaves the module cache read-only, so make the isolated HOME writable
  # before removing it.
  chmod -R u+w "${WORK_HOME}" 2>/dev/null || true
  rm -rf "${WORK_HOME}"
  if [[ ${rc} -ne 0 ]]; then
    print -u2 "acceptance isolation: FAILED; logs at ${LOG_DIR}"
  else
    rm -rf "${LOG_DIR}"
  fi
  return ${rc}
}
trap cleanup EXIT

cd -- "${REPO_ROOT}"

print "acceptance isolation: build HOME=${WORK_HOME}"
rm -rf .task frontend/dist flashnote
HOME="${WORK_HOME}" \
  GOCACHE="${GO_CACHE}" \
  GOMODCACHE="${GO_MODCACHE}" \
  VITE_FLASHNOTE_ACCEPTANCE_TEXT="${ACCEPTANCE_TEXT}" \
  VITE_FLASHNOTE_ACCEPTANCE_HOME="${WORK_HOME}" \
  ${VITE_FLASHNOTE_DATA_SAFETY_ACCEPTANCE:+VITE_FLASHNOTE_DATA_SAFETY_ACCEPTANCE="${DATA_SAFETY_MODE}"} \
  wails3 build >"${BUILD_LOG}" 2>&1
test -x ./flashnote

# The isolated HOME is exported for the run by this same process, so the
# acceptance build and the acceptance process cannot disagree about where data
# lives.
print "acceptance isolation: run HOME=${WORK_HOME}"
HOME="${WORK_HOME}" VITE_FLASHNOTE_DATA_SAFETY_ACCEPTANCE="${DATA_SAFETY_MODE}" ./flashnote >"${RUN_LOG}" 2>&1 &
readonly RUN_PID=$!
for _ in $(seq 1 240); do
  if ! kill -0 "${RUN_PID}" 2>/dev/null; then break; fi
  sleep 1
done
if kill -0 "${RUN_PID}" 2>/dev/null; then
  kill "${RUN_PID}" 2>/dev/null || true
  wait "${RUN_PID}" 2>/dev/null || true
  print -u2 "acceptance isolation: acceptance app did not exit"
  exit 1
fi
wait "${RUN_PID}" || true

# The isolation gate mirrors any refusal into the application log, and the
# application logs the data directory it actually resolved. A mismatch must stop
# the run here rather than be explained away by its verdict.
if grep -q "FLASHNOTE_ACCEPTANCE_ISOLATION_REFUSED" "${RUN_LOG}"; then
  print -u2 "acceptance isolation: the app refused the run as non-isolated"
  grep "FLASHNOTE_ACCEPTANCE_ISOLATION_REFUSED" "${RUN_LOG}" >&2 || true
  exit 1
fi
if grep -q "FLASHNOTE_DATA_DIR path=" "${RUN_LOG}"; then
  if grep "FLASHNOTE_DATA_DIR path=" "${RUN_LOG}" | grep -qv "FLASHNOTE_DATA_DIR path=${WORK_HOME}/"; then
    print -u2 "acceptance isolation: app resolved a data directory OUTSIDE the isolated HOME"
    grep "FLASHNOTE_DATA_DIR path=" "${RUN_LOG}" >&2 || true
    exit 1
  fi
  print "acceptance isolation: app resolved data directory inside the isolated HOME"
fi

# Durable proof lives in the isolated database: the pipeline records its verdict
# as a note, so a silent failure cannot look like success.
readonly ISOLATED_DB="${WORK_HOME}/Library/Application Support/Flashnote/flashnote.db"
if [[ ! -f "${ISOLATED_DB}" ]]; then
  print -u2 "acceptance isolation: isolated database was never created at ${ISOLATED_DB}"
  exit 1
fi
readonly VERDICT="$(sqlite3 "${ISOLATED_DB}" \
  "SELECT title FROM notes WHERE title LIKE 'FLASHNOTE_SCROLL_ACCEPTANCE%' ORDER BY updated_at DESC LIMIT 1;" || true)"
if [[ -z "${VERDICT}" ]]; then
  print -u2 "acceptance isolation: no scroll-structure verdict note was recorded"
  sqlite3 "${ISOLATED_DB}" "SELECT title FROM notes ORDER BY updated_at DESC LIMIT 5;" >&2 || true
  exit 1
fi
print "acceptance isolation: verdict ${VERDICT}"

# The real data directory must be byte-identical to before the run.
readonly REAL_AFTER="${LOG_DIR}/real-data-after.md5"
fingerprint_real_data >"${REAL_AFTER}"
if ! diff -q "${REAL_BEFORE}" "${REAL_AFTER}" >/dev/null; then
  print -u2 "acceptance isolation: real data directory CHANGED during the acceptance run"
  diff "${REAL_BEFORE}" "${REAL_AFTER}" >&2 || true
  exit 1
fi
print "acceptance isolation: real data directory unchanged"

print "acceptance isolation: PASS"
