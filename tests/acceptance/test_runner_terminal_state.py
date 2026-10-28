"""Acceptance-runner terminal-state contract regression coverage.

The runner's job is to turn one native acceptance run into exactly one truth:
PASS, or a specific reason it is not. These tests pin the boundaries that used
to be decided by "something exists", so a forced kill, a non-zero exit, a
discarded close, or a verdict that could not be read cannot be mistaken for a
completed run.

The verdict-query boundary is proven by executing the runner's own verdict
section under real zsh against real SQLite databases, because the status of a
shell command is a runtime property: the text-level checks below passed while
`readonly VERDICT_BREAKDOWN="$(sqlite3 ...)"` followed by
`readonly VERDICT_SQL_STATUS=$?` reported zero for a query that had just
failed.
"""

from __future__ import annotations

import re
import shutil
import sqlite3
import subprocess
import tempfile
import unittest
from pathlib import Path
from typing import Sequence

RUNNER_PATH = Path(__file__).resolve().parents[2] / 'scripts' / 'run-acceptance.sh'

OK_TITLE = 'FLASHNOTE_SCROLL_ACCEPTANCE_OK'
NOTES_SCHEMA = (
    'CREATE TABLE notes ('
    'id TEXT PRIMARY KEY, title TEXT, revision INTEGER, updated_at TEXT)'
)


def read_runner() -> str:
    return RUNNER_PATH.read_text(encoding='utf-8')


def strip_comments(script: str) -> str:
    """Remove comment lines so a contract cannot be satisfied by prose alone."""
    return '\n'.join(
        line for line in script.splitlines() if not line.lstrip().startswith('#')
    )


class RunnerTerminalStateContractTest(unittest.TestCase):
    def test_the_runner_proves_a_normal_approved_close_before_declaring_pass(self) -> None:
        script = strip_comments(read_runner())
        self.assertIn('FLASHNOTE_CLOSE_APPROVED', script)
        self.assertIn('FLASHNOTE_CLOSE_DISCARDED', script)
        # An approved close must be required, not merely observed when present.
        self.assertRegex(script, r'if ! grep -q "FLASHNOTE_CLOSE_APPROVED"')

    def test_a_discarded_close_fails_the_run(self) -> None:
        script = strip_comments(read_runner())
        self.assertRegex(script, r'if grep -q "FLASHNOTE_CLOSE_DISCARDED"')

    def test_the_app_exit_status_is_not_discarded(self) -> None:
        script = strip_comments(read_runner())
        # The old form was `wait "${RUN_PID}" || true`, which accepted any
        # terminal state including a crash.
        self.assertNotRegex(script, r'wait "\$\{RUN_PID\}" \|\| true')
        self.assertRegex(script, r'wait "\$\{RUN_PID\}" && APP_EXIT_STATUS=0 \|\| APP_EXIT_STATUS=\$\?')
        self.assertRegex(script, r'if \[\[ "\$\{APP_EXIT_STATUS\}" -ne 0 \]\]')

    def test_a_forced_termination_fails_the_run(self) -> None:
        script = strip_comments(read_runner())
        # A run killed by the runner's own timeout is not a completed run even
        # when a verdict note exists.
        self.assertRegex(script, r'forced termination is not a completed run')
        self.assertRegex(script, r'if \[\[ "\$\{APP_FORCED_EXIT\}" -ne 0 \]\]')

    def test_a_missing_close_path_fails_the_run(self) -> None:
        script = strip_comments(read_runner())
        self.assertRegex(script, r'never reached the native close path')

    def test_the_verdict_query_does_not_swallow_its_own_exit_status(self) -> None:
        script = strip_comments(read_runner())
        # A SQL failure must be distinguishable from a missing verdict, so the
        # query can no longer end in `|| true`.
        query_area = script[script.index('VERDICT_QUERY=') : script.index('print "acceptance isolation: verdict counts')]
        self.assertNotIn('|| true', query_area)
        self.assertIn('VERDICT_SQL_STATUS=$?', query_area)
        self.assertIn('if [[ "${VERDICT_SQL_STATUS}" -ne 0 ]]', query_area)

    def test_the_verdict_is_decided_by_exact_counts_not_by_ordering(self) -> None:
        script = strip_comments(read_runner())
        # Ordering cannot distinguish a real success from a FAILED row, a
        # duplicate, or an ambiguous prefix written in the same second.
        self.assertNotIn('ORDER BY updated_at DESC LIMIT 1', script)
        self.assertIn('VERDICT_FAILED_COUNT', script)
        self.assertIn('VERDICT_OK', script)

    def test_the_verdict_diagnostics_survive_the_isolated_home_cleanup(self) -> None:
        script = strip_comments(read_runner())
        # The isolated HOME is removed in cleanup, so the note titles that can
        # explain a verdict must be captured before that happens.
        self.assertIn('capture_verdict_diagnostics', script)
        self.assertIn('isolated-note-titles.txt', script)
        self.assertIn('scroll-verdict-notes.txt', script)
        self.assertIn('acceptance-stage-history.txt', script)

    def test_the_verdict_query_status_is_not_masked_by_readonly(self) -> None:
        script = strip_comments(read_runner())
        # `readonly VAR="$(cmd)"` reports the readonly builtin's own success, so
        # `readonly VERDICT_SQL_STATUS=$?` beside it read zero even while the
        # query failed; the check that depends on that status was dead code.
        self.assertNotIn('readonly VERDICT_BREAKDOWN="$(sqlite3', script)
        self.assertNotIn('readonly VERDICT_SQL_STATUS=$?', script)


@unittest.skipUnless(
    shutil.which('zsh') and shutil.which('sqlite3'),
    'the acceptance runner is a zsh script judged by sqlite3; neither may be faked here',
)
class VerdictQueryExitStatusTest(unittest.TestCase):
    """The runner's verdict section, executed for real.

    The extraction runs the runner's own text rather than a copy of it, so a
    change to the runner is what this test executes - a translated snippet could
    pass while the runner itself still masked the query's status.
    """

    def extract_verdict_section(self) -> str:
        script = read_runner()
        return script[script.index('readonly VERDICT_QUERY='):]

    def run_verdict_section(self, database_path: str) -> subprocess.CompletedProcess:
        harness = '\n'.join(
            [
                'set -euo pipefail',
                'ISOLATED_DB="$1"',
                'LOG_DIR="$2"',
                self.extract_verdict_section(),
            ]
        )
        with tempfile.TemporaryDirectory() as log_dir:
            return subprocess.run(
                ['zsh', '-c', harness, 'zsh', database_path, log_dir],
                capture_output=True,
                text=True,
                timeout=120,
            )

    def make_database(self, titles: Sequence[str] = ()) -> str:
        handle = tempfile.NamedTemporaryFile(suffix='.db', delete=False)
        handle.close()
        path = handle.name
        connection = sqlite3.connect(path)
        try:
            connection.execute(NOTES_SCHEMA)
            connection.executemany(
                'INSERT INTO notes (id, title, revision, updated_at) VALUES (?, ?, ?, ?)',
                [
                    (f'note-{index}', title, 1, '2026-10-28 12:00:00')
                    for index, title in enumerate(titles)
                ],
            )
            connection.commit()
        finally:
            connection.close()
        return path

    def make_unqueryable_database(self) -> str:
        # A real file the engine cannot answer the verdict query against.
        handle = tempfile.NamedTemporaryFile(suffix='.db', delete=False)
        handle.close()
        return handle.name

    def test_a_readable_ok_verdict_still_passes_through_the_real_shell(self) -> None:
        database = self.make_database([OK_TITLE])
        try:
            completed = self.run_verdict_section(database)
        finally:
            Path(database).unlink(missing_ok=True)
        self.assertEqual(completed.returncode, 0, completed.stderr)
        self.assertIn('verdict FLASHNOTE_SCROLL_ACCEPTANCE_OK', completed.stdout)

    def test_a_failing_verdict_query_fails_with_its_own_reason(self) -> None:
        database = self.make_unqueryable_database()
        try:
            completed = self.run_verdict_section(database)
        finally:
            Path(database).unlink(missing_ok=True)
        # A verdict that cannot be read is not a pass and not a missing verdict:
        # it must be reported as the query failure it is.
        self.assertEqual(completed.returncode, 1)
        self.assertIn('the verdict query itself failed', completed.stderr)

    def test_a_missing_verdict_is_reported_differently_from_a_failing_query(self) -> None:
        # The distinction the masked status destroyed: a readable database that
        # simply holds no verdict note must reach the missing-verdict report,
        # never the query-failure report.
        database = self.make_database(['an ordinary note title'])
        try:
            completed = self.run_verdict_section(database)
        finally:
            Path(database).unlink(missing_ok=True)
        self.assertEqual(completed.returncode, 1)
        self.assertIn('no scroll-structure verdict note was recorded', completed.stderr)
        self.assertNotIn('the verdict query itself failed', completed.stderr)

    def test_a_failed_verdict_note_fails_through_the_real_shell(self) -> None:
        database = self.make_database(['FLASHNOTE_SCROLL_ACCEPTANCE_FAILED'])
        try:
            completed = self.run_verdict_section(database)
        finally:
            Path(database).unlink(missing_ok=True)
        self.assertEqual(completed.returncode, 1)
        self.assertIn('a FAILED verdict note is present', completed.stderr)


if __name__ == '__main__':
    unittest.main()
