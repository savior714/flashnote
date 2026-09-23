#!/usr/bin/env python3
"""Minimal Flashnote detached-worktree lifecycle helper.

This module owns only Git workspace mechanics:
- establish fresh origin/main authority;
- create a clean detached transient worktree at that exact revision;
- inspect one worktree; and
- retire one helper-managed worktree only when its current HEAD is proven
  published in fresh origin/main.

It does not own task identity, semantic admission, publication, proof, queues,
locks, owner tokens, or disposal of unpublished work.
"""

from __future__ import annotations

import argparse
import subprocess
import tempfile
import uuid
from dataclasses import dataclass
from pathlib import Path

RESULT_CREATED = "CREATED"
RESULT_INSPECTED = "INSPECTED"
RESULT_RETIRED = "RETIRED"
RESULT_PRESERVED = "PRESERVED"
RESULT_ERROR = "ERROR"


@dataclass(frozen=True)
class CommandResult:
    result: str
    reason: str = ""
    workspace: str = ""
    admitted_base: str = ""
    head: str = ""
    remote_tip: str = ""


def _run(repo: str | Path, *args: str, check: bool = True) -> subprocess.CompletedProcess[str]:
    proc = subprocess.run(
        ["git", "-C", str(repo), *args],
        capture_output=True,
        text=True,
        check=False,
    )
    if check and proc.returncode != 0:
        detail = proc.stderr.strip() or proc.stdout.strip() or f"exit {proc.returncode}"
        raise RuntimeError(f"git {' '.join(args)} failed: {detail}")
    return proc


def _rev(repo: str | Path, ref: str) -> str:
    proc = _run(repo, "rev-parse", "--verify", ref, check=False)
    return proc.stdout.strip() if proc.returncode == 0 else ""


def _top(repo: str | Path) -> Path:
    proc = _run(repo, "rev-parse", "--show-toplevel")
    return Path(proc.stdout.strip()).resolve()


def managed_root(root: str | Path | None = None) -> Path:
    path = Path(root) if root is not None else Path(tempfile.gettempdir()) / "flashnote-worktrees"
    return path.expanduser().resolve()


def _inside(child: Path, parent: Path) -> bool:
    try:
        child.relative_to(parent)
        return True
    except ValueError:
        return False


def _registered_worktrees(repo: str | Path) -> set[Path]:
    proc = _run(repo, "worktree", "list", "--porcelain")
    out: set[Path] = set()
    for line in proc.stdout.splitlines():
        if line.startswith("worktree "):
            out.add(Path(line.removeprefix("worktree ")).resolve())
    return out


def _is_clean(workspace: str | Path) -> bool:
    proc = _run(workspace, "status", "--porcelain=v1", "--untracked-files=all")
    return proc.stdout == ""


def _is_detached(workspace: str | Path) -> bool:
    proc = _run(workspace, "symbolic-ref", "-q", "HEAD", check=False)
    return proc.returncode != 0


def _git_dir(workspace: str | Path) -> Path:
    proc = _run(workspace, "rev-parse", "--absolute-git-dir")
    return Path(proc.stdout.strip()).resolve()


def _active_git_operation(workspace: str | Path) -> str:
    git_dir = _git_dir(workspace)
    markers = (
        "MERGE_HEAD",
        "CHERRY_PICK_HEAD",
        "REVERT_HEAD",
        "BISECT_LOG",
        "rebase-merge",
        "rebase-apply",
    )
    for marker in markers:
        if (git_dir / marker).exists():
            return marker
    return ""


def fetch_remote_tip(repo: str | Path, remote: str = "origin", branch: str = "main") -> str:
    fetched = _run(repo, "fetch", remote, branch, check=False)
    if fetched.returncode != 0:
        detail = fetched.stderr.strip() or fetched.stdout.strip() or f"exit {fetched.returncode}"
        raise RuntimeError(f"fresh fetch failed: {detail}")
    tip = _rev(repo, f"{remote}/{branch}")
    if not tip:
        raise RuntimeError(f"fresh fetch did not establish {remote}/{branch}")
    return tip


def create_workspace(
    repo: str | Path = ".",
    *,
    remote: str = "origin",
    branch: str = "main",
    root: str | Path | None = None,
) -> CommandResult:
    try:
        repo_top = _top(repo)
        admitted = fetch_remote_tip(repo_top, remote, branch)
        root_path = managed_root(root)
        root_path.mkdir(parents=True, exist_ok=True)
        path = root_path / f"wt-{uuid.uuid4().hex[:12]}"
        created = _run(repo_top, "worktree", "add", "--detach", str(path), admitted, check=False)
        if created.returncode != 0:
            detail = created.stderr.strip() or created.stdout.strip() or f"exit {created.returncode}"
            return CommandResult(RESULT_ERROR, f"worktree creation failed: {detail}")
        head = _rev(path, "HEAD")
        if head != admitted or not _is_detached(path) or not _is_clean(path):
            return CommandResult(
                RESULT_ERROR,
                "created worktree failed detached/clean/admitted-base read-back; preserved for inspection",
                workspace=str(path),
                admitted_base=admitted,
                head=head,
            )
        return CommandResult(
            RESULT_CREATED,
            "fresh detached workspace established",
            workspace=str(path),
            admitted_base=admitted,
            head=head,
        )
    except (OSError, RuntimeError) as exc:
        return CommandResult(RESULT_ERROR, str(exc))


def inspect_workspace(repo: str | Path, workspace: str | Path) -> CommandResult:
    try:
        repo_top = _top(repo)
        path = Path(workspace).expanduser().resolve()
        if path not in _registered_worktrees(repo_top):
            return CommandResult(RESULT_ERROR, "workspace is not registered to this repository", workspace=str(path))
        head = _rev(path, "HEAD")
        state = []
        state.append("detached" if _is_detached(path) else "attached")
        state.append("clean" if _is_clean(path) else "dirty")
        operation = _active_git_operation(path)
        if operation:
            state.append(f"operation={operation}")
        return CommandResult(RESULT_INSPECTED, ", ".join(state), workspace=str(path), head=head)
    except (OSError, RuntimeError) as exc:
        return CommandResult(RESULT_ERROR, str(exc), workspace=str(workspace))


def cleanup_workspace(
    repo: str | Path,
    workspace: str | Path,
    *,
    remote: str = "origin",
    branch: str = "main",
    root: str | Path | None = None,
) -> CommandResult:
    """Retire exactly one helper-managed worktree iff its HEAD is published.

    Dirty, attached, active-operation, unregistered, unpublished, fetch-failed,
    and otherwise unknown states are preserved. No reset/clean/stash/discard is
    ever attempted.
    """
    path = Path(workspace).expanduser().resolve()
    try:
        repo_top = _top(repo)
        root_path = managed_root(root)
        if not _inside(path, root_path):
            return CommandResult(RESULT_PRESERVED, "workspace is outside the helper-managed transient root", workspace=str(path))
        if path not in _registered_worktrees(repo_top):
            return CommandResult(RESULT_PRESERVED, "workspace is not registered to this repository", workspace=str(path))
        if not _is_detached(path):
            return CommandResult(RESULT_PRESERVED, "workspace is attached to a branch", workspace=str(path))
        operation = _active_git_operation(path)
        if operation:
            return CommandResult(RESULT_PRESERVED, f"active Git operation detected: {operation}", workspace=str(path))
        if not _is_clean(path):
            return CommandResult(RESULT_PRESERVED, "workspace is dirty or has untracked state", workspace=str(path))

        head = _rev(path, "HEAD")
        if not head:
            return CommandResult(RESULT_PRESERVED, "workspace HEAD could not be established", workspace=str(path))
        try:
            remote_tip = fetch_remote_tip(repo_top, remote, branch)
        except RuntimeError as exc:
            return CommandResult(RESULT_PRESERVED, str(exc), workspace=str(path), head=head)

        contained = _run(repo_top, "merge-base", "--is-ancestor", head, remote_tip, check=False)
        if contained.returncode != 0:
            return CommandResult(
                RESULT_PRESERVED,
                "workspace HEAD is not contained in fresh remote; unpublished candidate preserved",
                workspace=str(path),
                head=head,
                remote_tip=remote_tip,
            )

        removed = _run(repo_top, "worktree", "remove", str(path), check=False)
        if removed.returncode != 0:
            detail = removed.stderr.strip() or removed.stdout.strip() or f"exit {removed.returncode}"
            return CommandResult(
                RESULT_PRESERVED,
                f"worktree removal refused: {detail}",
                workspace=str(path),
                head=head,
                remote_tip=remote_tip,
            )
        if path in _registered_worktrees(repo_top) or path.exists():
            return CommandResult(
                RESULT_ERROR,
                "worktree removal returned success but read-back still finds residue",
                workspace=str(path),
                head=head,
                remote_tip=remote_tip,
            )
        return CommandResult(
            RESULT_RETIRED,
            "published detached workspace removed and registration read-back passed",
            workspace=str(path),
            head=head,
            remote_tip=remote_tip,
        )
    except (OSError, RuntimeError) as exc:
        return CommandResult(RESULT_PRESERVED, str(exc), workspace=str(path))


def _emit(result: CommandResult) -> int:
    print(f"RESULT={result.result}")
    if result.workspace:
        print(f"WORKSPACE={result.workspace}")
    if result.admitted_base:
        print(f"ADMITTED_BASE={result.admitted_base}")
    if result.head:
        print(f"HEAD={result.head}")
    if result.remote_tip:
        print(f"REMOTE_TIP={result.remote_tip}")
    if result.reason:
        print(f"REASON={result.reason}")
    return 0 if result.result in {RESULT_CREATED, RESULT_INSPECTED, RESULT_RETIRED} else 1


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)

    create = sub.add_parser("create")
    create.add_argument("--repo", default=".")
    create.add_argument("--remote", default="origin")
    create.add_argument("--branch", default="main")
    create.add_argument("--root")

    inspect = sub.add_parser("inspect")
    inspect.add_argument("workspace")
    inspect.add_argument("--repo", default=".")

    cleanup = sub.add_parser("cleanup")
    cleanup.add_argument("workspace")
    cleanup.add_argument("--repo", default=".")
    cleanup.add_argument("--remote", default="origin")
    cleanup.add_argument("--branch", default="main")
    cleanup.add_argument("--root")

    args = parser.parse_args(argv)
    if args.command == "create":
        return _emit(create_workspace(args.repo, remote=args.remote, branch=args.branch, root=args.root))
    if args.command == "inspect":
        return _emit(inspect_workspace(args.repo, args.workspace))
    return _emit(cleanup_workspace(args.repo, args.workspace, remote=args.remote, branch=args.branch, root=args.root))


if __name__ == "__main__":
    raise SystemExit(main())
