"""Acceptance-runner terminal-state contract regression coverage.

The runner's job is to turn one native acceptance run into exactly one truth:
PASS, or a specific reason it is not. These tests pin the two boundaries that
used to be decided by "something exists", so a forced kill, a non-zero exit, or
a discarded close cannot be read as a completed run.
"""

from __future__ import annotations

import re
import unittest
from pathlib import Path

RUNNER_PATH = Path(__file__).resolve().parents[2] / 'scripts' / 'run-acceptance.sh'


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


if __name__ == '__main__':
    unittest.main()
