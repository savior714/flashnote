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
# Before the acceptance process is started this runner guarantees, in order:
#   1. the binary it is about to run was built from this exact checkout - its
#      embedded vcs.revision, read back with `go version -m`, must equal HEAD;
#   2. the run HOME and the baked VITE_FLASHNOTE_ACCEPTANCE_HOME are the same
#      freshly created isolated HOME, never the real one;
#   3. the app refuses any acceptance step - before writing a single datum -
#      unless that baked HOME matches the data directory it resolves.
# A mis-built or mis-isolated run therefore stops before it can touch data, so
# it can never report a verdict it did not earn.
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

# Proved on every exit path (see cleanup): the real data directory must be
# byte-identical to what it was before the run, whether the run passed or not.
verify_real_data_unchanged() {
  local after="${LOG_DIR}/real-data-after.md5"
  fingerprint_real_data >"${after}"
  if ! diff -q "${REAL_BEFORE}" "${after}" >/dev/null; then
    print -u2 "acceptance isolation: real data directory CHANGED during the acceptance run"
    diff "${REAL_BEFORE}" "${after}" >&2 || true
    return 1
  fi
  print "acceptance isolation: real data directory unchanged"
  return 0
}

# Preserved before the isolated HOME is deleted. The database and the note
# titles it holds are the durable state of a stopped run, and the application
# log's stage markers are the only record of how far the pipeline actually got.
capture_verdict_diagnostics() {
  local db="${WORK_HOME}/Library/Application Support/Flashnote/flashnote.db"
  if [[ -f "${db}" ]]; then
    sqlite3 -batch "${db}" \
      "SELECT title FROM notes ORDER BY updated_at DESC LIMIT 20;" \
      >"${LOG_DIR}/isolated-note-titles.txt" 2>>"${LOG_DIR}/verdict-sql-error.log" || true
    sqlite3 -batch "${db}" \
      "SELECT id, title, revision, updated_at FROM notes WHERE title LIKE 'FLASHNOTE_SCROLL_ACCEPTANCE%' ORDER BY updated_at DESC;" \
      >"${LOG_DIR}/scroll-verdict-notes.txt" 2>>"${LOG_DIR}/verdict-sql-error.log" || true
  fi
  grep -o 'FLASHNOTE_NOTE_SEARCH query_len=[0-9]*' "${RUN_LOG}" 2>/dev/null \
    >"${LOG_DIR}/acceptance-stage-history.txt" || true
}

cleanup() {
  local rc=$?
  # The isolated HOME is removed below, so anything needed to explain the run is
  # copied out first. The verdict query and the recorded note titles are the
  # durable state; the application log is the stage history.
  capture_verdict_diagnostics
  # The real data directory must be proven untouched on every exit path, not
  # only on a passing one: a failing run is exactly the one where an isolation
  # hole would otherwise hide.
  verify_real_data_unchanged
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

# The binary that is about to run must be the build from THIS checkout. The Go
# toolchain stamps vcs.revision into the binary at build time; read it back with
# `go version -m` (out of the binary itself, so there is no separate stamp to
# drift from it) and refuse to launch a binary that is not this exact source
# revision. This runs before the process starts, so a stale or foreign binary
# cannot write any acceptance data before the run is stopped.
BINARY_REVISION="$(go version -m ./flashnote 2>/dev/null | sed -n 's/.*build\tvcs.revision=//p' | head -1)"
if [[ -z "${BINARY_REVISION}" ]]; then
  print -u2 "acceptance isolation: refusing to run; ./flashnote carries no vcs.revision stamp (was it built outside a checkout?)"
  exit 1
fi
HEAD_REVISION="$(git -C "${REPO_ROOT}" rev-parse HEAD)"
if [[ "${BINARY_REVISION}" != "${HEAD_REVISION}" ]]; then
  print -u2 "acceptance isolation: refusing to run; ./flashnote was built from ${BINARY_REVISION}, not this checkout (${HEAD_REVISION})"
  exit 1
fi
print "acceptance isolation: binary verified to be built from ${BINARY_REVISION}"

# Immediately before launch, re-assert the two run-time guarantees this runner
# owns by construction: the process runs in the isolated HOME - never the real
# one - and that isolated HOME is the one baked into the build as
# VITE_FLASHNOTE_ACCEPTANCE_HOME, so the acceptance build and the acceptance
# process cannot disagree about where data lives. The app additionally refuses
# any acceptance step, before the first datum is written, unless that baked HOME
# matches the data directory it resolves.
if [[ "${WORK_HOME}" == "${REAL_HOME}" ]]; then
  print -u2 "acceptance isolation: refusing to run; run HOME is the real HOME (${REAL_HOME})"
  exit 1
fi
print "acceptance isolation: run HOME=${WORK_HOME} (baked VITE_FLASHNOTE_ACCEPTANCE_HOME is the same HOME)"
HOME="${WORK_HOME}" VITE_FLASHNOTE_DATA_SAFETY_ACCEPTANCE="${DATA_SAFETY_MODE}" ./flashnote >"${RUN_LOG}" 2>&1 &
readonly RUN_PID=$!
# The app must terminate on its own. A process that outlives this budget was
# killed, not run to completion, so the run below is not a terminal state.
readonly RUN_TIMEOUT_SECONDS=240
for _ in $(seq 1 "${RUN_TIMEOUT_SECONDS}"); do
  if ! kill -0 "${RUN_PID}" 2>/dev/null; then break; fi
  sleep 1
done
APP_EXIT_STATUS=-1
if kill -0 "${RUN_PID}" 2>/dev/null; then
  # Forcibly terminated: capture the intent and the status the kill produced so
  # the run is reported as forced rather than silently as an OK one.
  kill "${RUN_PID}" 2>/dev/null || true
  wait "${RUN_PID}" 2>/dev/null || true
  readonly APP_FORCED_EXIT=1
  print -u2 "acceptance isolation: the acceptance app was forcibly terminated after ${RUN_TIMEOUT_SECONDS}s"
else
  readonly APP_FORCED_EXIT=0
  wait "${RUN_PID}" && APP_EXIT_STATUS=0 || APP_EXIT_STATUS=$?
fi
readonly APP_EXIT_STATUS="${APP_EXIT_STATUS}"
if [[ "${APP_FORCED_EXIT}" -ne 0 ]]; then
  print -u2 "acceptance isolation: forced termination is not a completed run; a verdict note is not sufficient"
  exit 1
fi
if [[ "${APP_EXIT_STATUS}" -ne 0 ]]; then
  print -u2 "acceptance isolation: the acceptance app exited with status ${APP_EXIT_STATUS} instead of 0"
  exit 1
fi
print "acceptance isolation: the acceptance app exited on its own with status ${APP_EXIT_STATUS}"

# The native close path decides which terminal state the app reached. A normal
# close flushes the pending draft and is approved; a discarded close throws the
# draft away. Only the approved path may produce a passing acceptance.
if ! grep -q "FLASHNOTE_CLOSE_FLUSH_REQUESTED" "${RUN_LOG}"; then
  print -u2 "acceptance isolation: the run never reached the native close path, so no verdict note proves a completed run"
  exit 1
fi
if grep -q "FLASHNOTE_CLOSE_DISCARDED" "${RUN_LOG}"; then
  print -u2 "acceptance isolation: the run closed through the discard path, which is not a verified-saved state"
  exit 1
fi
if ! grep -q "FLASHNOTE_CLOSE_APPROVED" "${RUN_LOG}"; then
  print -u2 "acceptance isolation: the run never recorded a normal approved close"
  exit 1
fi
print "acceptance isolation: the app closed through the normal approved path"

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

# SQLite diagnostics are captured before the isolated HOME is removed, so a
# verdict that could not be read can still be explained afterwards. A query
# failure must be distinguished from a missing verdict, so the query's real exit
# status has to reach the check below. `readonly VAR="$(cmd)"` reports the
# readonly builtin's own success, which masked every SQL failure behind a zero
# (and left the check below unreachable). The value and its status are captured
# beside one ordinary assignment instead: `|| VERDICT_SQL_STATUS=$?` records the
# failing status without letting `set -e` end the run before it is judged.
readonly VERDICT_QUERY="SELECT COUNT(*) AS total, COUNT(*) FILTER (WHERE title = 'FLASHNOTE_SCROLL_ACCEPTANCE_OK') AS ok_count, COUNT(*) FILTER (WHERE title = 'FLASHNOTE_SCROLL_ACCEPTANCE_FAILED') AS failed_count FROM notes WHERE title LIKE 'FLASHNOTE_SCROLL_ACCEPTANCE%';"
VERDICT_SQL_STATUS=0
VERDICT_BREAKDOWN="$(sqlite3 -batch "${ISOLATED_DB}" "${VERDICT_QUERY}" 2>>"${LOG_DIR}/verdict-sql-error.log")" || VERDICT_SQL_STATUS=$?
readonly VERDICT_BREAKDOWN VERDICT_SQL_STATUS
if [[ "${VERDICT_SQL_STATUS}" -ne 0 ]]; then
  print -u2 "acceptance isolation: the verdict query itself failed; a verdict cannot be read, which is not the same as a missing verdict"
  exit 1
fi

# The verdict is judged by exact counts, never by ordering. `ORDER BY
# updated_at DESC LIMIT 1` cannot tell a real success from a FAILED row, a
# duplicate, or an ambiguous prefix written in the same second, so every
# conflicting result fails instead.
readonly VERDICT_TOTAL="${${VERDICT_BREAKDOWN%%\|*}:?}"
readonly VERDICT_OK="${${VERDICT_BREAKDOWN#*\|}%%\|*}"
readonly VERDICT_FAILED_COUNT="${${VERDICT_BREAKDOWN##*\|}}"
print "acceptance isolation: verdict counts total=${VERDICT_TOTAL} ok=${VERDICT_OK} failed=${VERDICT_FAILED_COUNT}"

if [[ "${VERDICT_FAILED_COUNT}" -ne 0 ]]; then
  print -u2 "acceptance isolation: a FAILED verdict note is present (${VERDICT_FAILED_COUNT}), so this run is not a pass"
  exit 1
fi
if [[ "${VERDICT_TOTAL}" -ne 1 ]]; then
  if [[ "${VERDICT_TOTAL}" -eq 0 ]]; then
    print -u2 "acceptance isolation: no scroll-structure verdict note was recorded"
  else
    print -u2 "acceptance isolation: ambiguous scroll-structure verdict notes (total=${VERDICT_TOTAL}, ok=${VERDICT_OK}); exactly one OK is required"
  fi
  print -u2 "acceptance isolation: recorded note titles:"
  sqlite3 -batch "${ISOLATED_DB}" \
    "SELECT title FROM notes ORDER BY updated_at DESC LIMIT 5;" >&2 || true
  exit 1
fi
if [[ "${VERDICT_OK}" -ne 1 ]]; then
  print -u2 "acceptance isolation: the single verdict note is not an OK verdict (ok=${VERDICT_OK})"
  print -u2 "acceptance isolation: recorded note titles:"
  sqlite3 -batch "${ISOLATED_DB}" \
    "SELECT title FROM notes ORDER BY updated_at DESC LIMIT 5;" >&2 || true
  exit 1
fi
print "acceptance isolation: verdict FLASHNOTE_SCROLL_ACCEPTANCE_OK"

print "acceptance isolation: PASS"
