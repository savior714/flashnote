from __future__ import annotations

import importlib.util
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def _load(name: str, relative: str):
    spec = importlib.util.spec_from_file_location(name, ROOT / relative)
    module = importlib.util.module_from_spec(spec)
    assert spec and spec.loader
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


workspace = _load("flashnote_workspace", "scripts/git/workspace.py")
publish = _load("flashnote_publish", "scripts/git/publish.py")


def git(repo: Path, *args: str, check: bool = True) -> subprocess.CompletedProcess[str]:
    proc = subprocess.run(["git", "-C", str(repo), *args], capture_output=True, text=True, check=False)
    if check and proc.returncode != 0:
        raise AssertionError(f"git {' '.join(args)} failed:\nstdout={proc.stdout}\nstderr={proc.stderr}")
    return proc


def write(repo: Path, path: str, text: str) -> None:
    target = repo / path
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(text, encoding="utf-8")


def commit_all(repo: Path, message: str) -> str:
    git(repo, "add", "--all")
    git(repo, "commit", "-m", message)
    return git(repo, "rev-parse", "HEAD").stdout.strip()


class GitFixture(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.remote = self.root / "remote.git"
        self.tracking = self.root / "tracking"
        self.worker_root = self.root / "worktrees"

        subprocess.run(["git", "init", "--bare", str(self.remote)], check=True, capture_output=True, text=True)
        subprocess.run(["git", "clone", str(self.remote), str(self.tracking)], check=True, capture_output=True, text=True)
        git(self.tracking, "config", "user.name", "Flashnote Test")
        git(self.tracking, "config", "user.email", "flashnote-test@example.invalid")
        git(self.tracking, "checkout", "-b", "main")
        write(self.tracking, "note.txt", "base\n")
        write(self.tracking, "other.txt", "base\n")
        self.base = commit_all(self.tracking, "base")
        git(self.tracking, "push", "-u", "origin", "main")

    def tearDown(self) -> None:
        self.temp.cleanup()

    def create_worker(self):
        result = workspace.create_workspace(self.tracking, root=self.worker_root)
        self.assertEqual(workspace.RESULT_CREATED, result.result, result)
        path = Path(result.workspace)
        git(path, "config", "user.name", "Flashnote Test")
        git(path, "config", "user.email", "flashnote-test@example.invalid")
        return result, path

    def advance_remote(self, path: str, text: str, message: str) -> str:
        other = self.root / f"other-{message.replace(' ', '-')}"
        subprocess.run(["git", "clone", str(self.remote), str(other)], check=True, capture_output=True, text=True)
        git(other, "config", "user.name", "Other")
        git(other, "config", "user.email", "other@example.invalid")
        git(other, "checkout", "main")
        write(other, path, text)
        sha = commit_all(other, message)
        git(other, "push", "origin", "main")
        return sha


class WorkspaceTests(GitFixture):
    def test_create_is_fresh_clean_and_detached(self) -> None:
        result, path = self.create_worker()
        self.assertEqual(self.base, result.admitted_base)
        self.assertEqual(self.base, git(path, "rev-parse", "HEAD").stdout.strip())
        self.assertNotEqual(0, git(path, "symbolic-ref", "-q", "HEAD", check=False).returncode)
        self.assertEqual("", git(path, "status", "--porcelain=v1", "--untracked-files=all").stdout)

    def test_cleanup_preserves_dirty_workspace(self) -> None:
        _, path = self.create_worker()
        write(path, "note.txt", "dirty\n")
        result = workspace.cleanup_workspace(self.tracking, path, root=self.worker_root)
        self.assertEqual(workspace.RESULT_PRESERVED, result.result)
        self.assertIn("dirty", result.reason)
        self.assertTrue(path.exists())

    def test_cleanup_preserves_clean_unpublished_commit(self) -> None:
        _, path = self.create_worker()
        write(path, "note.txt", "candidate\n")
        commit_all(path, "candidate")
        result = workspace.cleanup_workspace(self.tracking, path, root=self.worker_root)
        self.assertEqual(workspace.RESULT_PRESERVED, result.result)
        self.assertIn("unpublished", result.reason)
        self.assertTrue(path.exists())

    def test_cleanup_removes_published_workspace_and_registration(self) -> None:
        created, path = self.create_worker()
        write(path, "note.txt", "candidate\n")
        commit_all(path, "candidate")
        outcome = publish.publish(path, created.admitted_base)
        self.assertEqual(publish.PUBLISHED, outcome.result, outcome)
        result = workspace.cleanup_workspace(self.tracking, path, root=self.worker_root)
        self.assertEqual(workspace.RESULT_RETIRED, result.result, result)
        self.assertFalse(path.exists())
        listing = git(self.tracking, "worktree", "list", "--porcelain").stdout
        self.assertNotIn(str(path), listing)


class PublishTests(GitFixture):
    def test_direct_fast_forward_publication_and_readback(self) -> None:
        created, path = self.create_worker()
        write(path, "note.txt", "candidate\n")
        candidate = commit_all(path, "candidate")
        result = publish.publish(path, created.admitted_base)
        self.assertEqual(publish.PUBLISHED, result.result, result)
        self.assertEqual(candidate, result.published_commit)
        git(self.tracking, "fetch", "origin", "main")
        remote_tip = git(self.tracking, "rev-parse", "origin/main").stdout.strip()
        self.assertEqual(candidate, remote_tip)

    def test_already_present_when_changed_paths_match_fresh_remote(self) -> None:
        created, path = self.create_worker()
        write(path, "note.txt", "same outcome\n")
        commit_all(path, "candidate")
        self.advance_remote("note.txt", "same outcome\n", "other representation")
        result = publish.publish(path, created.admitted_base)
        self.assertEqual(publish.ALREADY_PRESENT, result.result, result)

    def test_remote_advance_stops_without_rebind(self) -> None:
        created, path = self.create_worker()
        write(path, "note.txt", "candidate\n")
        commit_all(path, "candidate")
        remote_tip = self.advance_remote("other.txt", "upstream\n", "upstream")
        result = publish.publish(path, created.admitted_base)
        self.assertEqual(publish.REMOTE_ADVANCED, result.result, result)
        self.assertEqual(remote_tip, result.remote_tip)

    def test_authorized_one_shot_rebind_publishes_both_deltas(self) -> None:
        created, path = self.create_worker()
        write(path, "note.txt", "candidate\n")
        original = commit_all(path, "candidate")
        self.advance_remote("other.txt", "upstream\n", "upstream")
        result = publish.publish(path, created.admitted_base, rebind=True)
        self.assertEqual(publish.PUBLISHED, result.result, result)
        self.assertNotEqual(original, result.published_commit)
        self.assertEqual(result.published_commit, git(path, "rev-parse", "HEAD").stdout.strip())
        self.assertEqual("candidate\n", (path / "note.txt").read_text(encoding="utf-8"))
        self.assertEqual("upstream\n", (path / "other.txt").read_text(encoding="utf-8"))

    def test_rebind_conflict_preserves_original_candidate(self) -> None:
        created, path = self.create_worker()
        write(path, "note.txt", "candidate\n")
        original = commit_all(path, "candidate")
        self.advance_remote("note.txt", "different upstream\n", "conflict")
        result = publish.publish(path, created.admitted_base, rebind=True)
        self.assertEqual(publish.BINDING_CONFLICT, result.result, result)
        self.assertEqual(original, git(path, "rev-parse", "HEAD").stdout.strip())
        self.assertEqual("candidate\n", (path / "note.txt").read_text(encoding="utf-8"))


def task_script(task_name: str) -> str:
    lines = (ROOT / "Taskfile.yml").read_text(encoding="utf-8").splitlines()
    header = f"  {task_name}:"
    try:
        start = lines.index(header)
    except ValueError as exc:
        raise AssertionError(f"Taskfile missing {task_name}") from exc
    block_start = None
    for i in range(start + 1, len(lines)):
        if lines[i].startswith("  ") and not lines[i].startswith("    ") and lines[i].endswith(":"):
            break
        if lines[i].strip() == "- |":
            block_start = i + 1
            break
    if block_start is None:
        raise AssertionError(f"{task_name} has no literal shell block")
    body: list[str] = []
    for line in lines[block_start:]:
        if line.startswith("      "):
            body.append(line[6:])
        else:
            break
    return "\n".join(body) + "\n"


class StagedScopeTests(GitFixture):
    def run_gate(self, owned: str | None) -> subprocess.CompletedProcess[str]:
        env = os.environ.copy()
        if owned is None:
            env.pop("TASK_OWNED_PATHS", None)
        else:
            env["TASK_OWNED_PATHS"] = owned
        return subprocess.run(
            ["/bin/sh", "-c", task_script("git:staged-scope-check")],
            cwd=self.tracking,
            env=env,
            capture_output=True,
            text=True,
            check=False,
        )

    def stage_two(self) -> None:
        write(self.tracking, "note.txt", "note change\n")
        write(self.tracking, "other.txt", "other change\n")
        git(self.tracking, "add", "--", "note.txt", "other.txt")

    def test_missing_task_owned_paths_fails_closed(self) -> None:
        write(self.tracking, "note.txt", "note change\n")
        git(self.tracking, "add", "--", "note.txt")
        result = self.run_gate(None)
        self.assertNotEqual(0, result.returncode)
        self.assertIn("TASK_OWNED_PATHS", result.stderr)

    def test_foreign_staged_path_fails(self) -> None:
        self.stage_two()
        result = self.run_gate("note.txt")
        self.assertNotEqual(0, result.returncode)
        self.assertIn("outside TASK_OWNED_PATHS", result.stderr)

    def test_exact_owned_staged_set_passes(self) -> None:
        self.stage_two()
        result = self.run_gate("note.txt other.txt")
        self.assertEqual(0, result.returncode, result.stderr)
        self.assertIn("staged set is within TASK_OWNED_PATHS", result.stderr)


if __name__ == "__main__":
    unittest.main()
