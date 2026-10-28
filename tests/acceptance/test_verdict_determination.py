"""SQLite verdict determination regression coverage for scripts/run-acceptance.sh.

The scroll-structure acceptance verdict is judged only by what a fresh isolated
database actually contains. These tests pin that judgement contract against the
real SQLite engine rather than a mock, because every failure mode below - a
missing note, a FAILED-only run, an OK/FAILED pair written in the same second, a
duplicate OK, an ambiguous prefix - is a case the old
`ORDER BY updated_at DESC LIMIT 1` single-row lookup could not distinguish.
"""

from __future__ import annotations

import sqlite3
import unittest

VERDICT_QUERY = (
    "SELECT COUNT(*) AS total, "
    "COUNT(*) FILTER (WHERE title = 'FLASHNOTE_SCROLL_ACCEPTANCE_OK') AS ok_count, "
    "COUNT(*) FILTER (WHERE title = 'FLASHNOTE_SCROLL_ACCEPTANCE_FAILED') AS failed_count "
    "FROM notes WHERE title LIKE 'FLASHNOTE_SCROLL_ACCEPTANCE%';"
)

OK_TITLE = "FLASHNOTE_SCROLL_ACCEPTANCE_OK"
FAILED_TITLE = "FLASHNOTE_SCROLL_ACCEPTANCE_FAILED"

SCHEMA = "CREATE TABLE notes (id TEXT PRIMARY KEY, title TEXT, updated_at TEXT)"

# One timestamp, shared by every row that has to be timestamp-indistinguishable.
# The old ordering-based lookup could not survive this case.
SAME_TIMESTAMP = "2026-10-28 12:00:00.000"


def classify_database(path: str) -> str:
    """Mirror the runner's verdict decision over a database file."""
    connection = sqlite3.connect(path)
    try:
        try:
            row = connection.execute(VERDICT_QUERY).fetchone()
        except sqlite3.Error as error:
            return f"sql_error:{error}"
        if row is None:
            return "sql_error:no row returned"
        total, ok_count, failed_count = (int(value) for value in row)
    finally:
        connection.close()
    if failed_count != 0:
        return "failed_verdict_present"
    if total != 1:
        if total == 0:
            return "no_verdict"
        return "ambiguous_verdict"
    if ok_count != 1:
        return "not_an_ok_verdict"
    return "ok_verdict"


def make_database(rows) -> str:
    """Create a temporary database holding the given (title, updated_at) rows."""
    import tempfile

    handle = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
    handle.close()
    path = handle.name
    connection = sqlite3.connect(path)
    try:
        connection.execute(SCHEMA)
        connection.executemany(
            "INSERT INTO notes (id, title, updated_at) VALUES (?, ?, ?)",
            [(f"note-{index}", title, updated_at) for index, (title, updated_at) in enumerate(rows)],
        )
        connection.commit()
    finally:
        connection.close()
    return path


class VerdictDeterminationTest(unittest.TestCase):
    def test_exactly_one_ok_verdict_passes(self) -> None:
        path = make_database([(OK_TITLE, SAME_TIMESTAMP)])
        try:
            self.assertEqual(classify_database(path), "ok_verdict")
        finally:
            remove(path)

    def test_missing_verdict_fails(self) -> None:
        path = make_database([("ordinary note title", SAME_TIMESTAMP)])
        try:
            self.assertEqual(classify_database(path), "no_verdict")
        finally:
            remove(path)

    def test_a_single_failed_verdict_fails(self) -> None:
        path = make_database([(FAILED_TITLE, SAME_TIMESTAMP)])
        try:
            self.assertEqual(classify_database(path), "failed_verdict_present")
        finally:
            remove(path)

    def test_ok_and_failed_coexisting_fails(self) -> None:
        path = make_database([(OK_TITLE, SAME_TIMESTAMP), (FAILED_TITLE, SAME_TIMESTAMP)])
        try:
            self.assertEqual(classify_database(path), "failed_verdict_present")
        finally:
            remove(path)

    def test_duplicate_ok_verdict_fails(self) -> None:
        path = make_database([(OK_TITLE, SAME_TIMESTAMP), (OK_TITLE, SAME_TIMESTAMP)])
        try:
            self.assertEqual(classify_database(path), "ambiguous_verdict")
        finally:
            remove(path)

    def test_ambiguous_prefix_verdict_fails(self) -> None:
        path = make_database([("FLASHNOTE_SCROLL_ACCEPTANCE_OKAY", SAME_TIMESTAMP)])
        try:
            self.assertEqual(classify_database(path), "not_an_ok_verdict")
        finally:
            remove(path)

    def test_ambiguous_prefix_alongside_ok_fails(self) -> None:
        path = make_database(
            [(OK_TITLE, SAME_TIMESTAMP), ("FLASHNOTE_SCROLL_ACCEPTANCE_NOTE", SAME_TIMESTAMP)],
        )
        try:
            self.assertEqual(classify_database(path), "ambiguous_verdict")
        finally:
            remove(path)

    def test_a_database_without_the_notes_table_fails_as_sql_error(self) -> None:
        import tempfile

        handle = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
        handle.close()
        path = handle.name
        try:
            self.assertTrue(classify_database(path).startswith("sql_error:"))
        finally:
            remove(path)

    def test_a_verdict_written_earlier_than_a_failing_check_does_not_pass(self) -> None:
        # The ordering-based lookup could read an older OK row as the latest
        # verdict when no FAILED row existed for the same run. Any FAILED row at
        # the same timestamp must still fail.
        path = make_database(
            [
                (OK_TITLE, "2026-10-28 11:59:59.000"),
                (FAILED_TITLE, SAME_TIMESTAMP),
            ],
        )
        try:
            self.assertEqual(classify_database(path), "failed_verdict_present")
        finally:
            remove(path)


def remove(path: str) -> None:
    import os

    try:
        os.unlink(path)
    except FileNotFoundError:
        pass


if __name__ == "__main__":
    unittest.main()
