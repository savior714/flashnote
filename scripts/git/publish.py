#!/usr/bin/env python3
"""Minimal Git-mechanical publication kernel for Flashnote.

The caller owns task meaning and proof validity. This helper owns only:
- fresh remote observation;
- direct fast-forward qualification;
- mechanical candidate-delta containment;
- optional caller-authorized one-shot full-delta rebinding;
- one ordinary non-force push; and
- exact remote containment read-back.

--rebind is never automatic semantic approval. The caller may request it only
after deciding that intervening remote movement is topology-only for the task.
"""

from __future__ import annotations

import argparse
import os
import subprocess
import tempfile
from dataclasses import dataclass
from pathlib import Path

PUBLISHED = "PUBLISHED"
NO_CHANGE = "NO_CHANGE"
ALREADY_PRESENT = "ALREADY_PRESENT"
REMOTE_ADVANCED = "REMOTE_ADVANCED"
BINDING_CONFLICT = "BINDING_CONFLICT"
PUSH_RACE = "PUSH_RACE"
ERROR = "ERROR"


@dataclass(frozen=True)
class PublishResult:
    result: str
    reason: str = ""
    candidate: str = ""
    remote_tip: str = ""
    published_commit: str = ""


def _run(
    repo: str | Path,
    *args: str,
    check: bool = True,
    input_bytes: bytes | None = None,
) -> subprocess.CompletedProcess:
    proc = subprocess.run(
        ["git", "-C", str(repo), *args],
        input=input_bytes,
        capture_output=True,
        text=input_bytes is None,
        check=False,
    )
    if check and proc.returncode != 0:
        stderr = proc.stderr.decode(errors="replace") if isinstance(proc.stderr, bytes) else proc.stderr
        stdout = proc.stdout.decode(errors="replace") if isinstance(proc.stdout, bytes) else proc.stdout
        detail = (stderr or "").strip() or (stdout or "").strip() or f"exit {proc.returncode}"
        raise RuntimeError(f"git {' '.join(args)} failed: {detail}")
    return proc


def _rev(repo: str | Path, ref: str) -> str:
    proc = _run(repo, "rev-parse", "--verify", ref, check=False)
    if proc.returncode != 0:
        return ""
    return proc.stdout.strip()


def _clean(repo: str | Path) -> bool:
    return _run(repo, "status", "--porcelain=v1", "--untracked-files=all").stdout == ""


def _fetch(repo: str | Path, remote: str, branch: str) -> str:
    proc = _run(repo, "fetch", remote, branch, check=False)
    if proc.returncode != 0:
        detail = proc.stderr.strip() or proc.stdout.strip() or f"exit {proc.returncode}"
        raise RuntimeError(f"fresh fetch failed: {detail}")
    tip = _rev(repo, f"{remote}/{branch}")
    if not tip:
        raise RuntimeError(f"fresh fetch did not establish {remote}/{branch}")
    return tip


def _is_ancestor(repo: str | Path, older: str, newer: str) -> bool:
    return _run(repo, "merge-base", "--is-ancestor", older, newer, check=False).returncode == 0


def _changed_paths(repo: str | Path, base: str, candidate: str) -> list[str]:
    proc = _run(repo, "diff", "--name-only", "--no-renames", "-z", base, candidate)
    return [part for part in proc.stdout.split("\0") if part]


def _tree_entry(repo: str | Path, commit: str, path: str) -> str:
    proc = _run(repo, "ls-tree", commit, "--", path)
    return proc.stdout


def candidate_delta_already_present(repo: str | Path, base: str, candidate: str, remote_tip: str) -> bool:
    paths = _changed_paths(repo, base, candidate)
    if not paths:
        return True
    return all(_tree_entry(repo, candidate, path) == _tree_entry(repo, remote_tip, path) for path in paths)


def _candidate_patch(repo: str | Path, base: str, candidate: str) -> bytes:
    proc = _run(repo, "diff", "--binary", "--full-index", "--no-renames", base, candidate)
    return proc.stdout.encode()


def _commit_message(repo: str | Path, candidate: str) -> str:
    return _run(repo, "show", "-s", "--format=%B", candidate).stdout.rstrip("\n")


def _remove_scratch(repo: str | Path, path: Path) -> None:
    # Scratch is created and exclusively owned by this invocation. It may be
    # dirty after a failed apply; force-removal is limited to that scratch path.
    _run(repo, "worktree", "remove", "--force", str(path), check=False)


def _rebind_once(repo: str | Path, base: str, candidate: str, remote_tip: str) -> tuple[str, str]:
    patch = _candidate_patch(repo, base, candidate)
    if not patch:
        return candidate, "candidate has no delta"

    with tempfile.TemporaryDirectory(prefix="flashnote-publish-") as parent:
        scratch = Path(parent) / "rebind"
        added = _run(repo, "worktree", "add", "--detach", str(scratch), remote_tip, check=False)
        if added.returncode != 0:
            detail = added.stderr.strip() or added.stdout.strip() or f"exit {added.returncode}"
            return "", f"scratch worktree creation failed: {detail}"
        try:
            applied = _run(scratch, "apply", "--index", "--3way", "-", check=False, input_bytes=patch)
            if applied.returncode != 0:
                detail_b = applied.stderr if isinstance(applied.stderr, bytes) else str(applied.stderr).encode()
                detail = detail_b.decode(errors="replace").strip() or f"exit {applied.returncode}"
                return "", f"candidate delta did not apply cleanly to fresh remote: {detail}"
            tree = _rev(scratch, "HEAD^{tree}")
            staged_tree = _run(scratch, "write-tree").stdout.strip()
            if not staged_tree or staged_tree == tree:
                return remote_tip, "rebind produced no tree delta"

            message = _commit_message(repo, candidate)
            env = os.environ.copy()
            env.setdefault("GIT_AUTHOR_NAME", "Flashnote")
            env.setdefault("GIT_AUTHOR_EMAIL", "flashnote@local")
            env.setdefault("GIT_COMMITTER_NAME", env["GIT_AUTHOR_NAME"])
            env.setdefault("GIT_COMMITTER_EMAIL", env["GIT_AUTHOR_EMAIL"])
            created = subprocess.run(
                ["git", "-C", str(scratch), "commit-tree", staged_tree, "-p", remote_tip],
                input=message + "\n",
                capture_output=True,
                text=True,
                env=env,
                check=False,
            )
            if created.returncode != 0:
                detail = created.stderr.strip() or created.stdout.strip() or f"exit {created.returncode}"
                return "", f"rebind commit creation failed: {detail}"
            rebound = created.stdout.strip()
            return rebound, "one-shot full-delta rebind created"
        finally:
            _remove_scratch(repo, scratch)


def _move_detached_workspace(repo: str | Path, commit: str) -> tuple[bool, str]:
    moved = _run(repo, "checkout", "--detach", commit, check=False)
    if moved.returncode != 0:
        detail = moved.stderr.strip() or moved.stdout.strip() or f"exit {moved.returncode}"
        return False, detail
    return _rev(repo, "HEAD") == commit and _clean(repo), ""


def _push_and_readback(repo: str | Path, candidate: str, remote: str, branch: str, observed_tip: str) -> PublishResult:
    pushed = _run(repo, "push", remote, f"{candidate}:refs/heads/{branch}", check=False)
    try:
        fresh = _fetch(repo, remote, branch)
    except RuntimeError as exc:
        return PublishResult(ERROR, f"push attempted but remote read-back failed: {exc}", candidate=candidate)

    if _is_ancestor(repo, candidate, fresh):
        return PublishResult(
            PUBLISHED,
            "candidate commit is contained in fresh remote read-back",
            candidate=candidate,
            remote_tip=fresh,
            published_commit=candidate,
        )
    if pushed.returncode != 0 and fresh != observed_tip:
        return PublishResult(
            PUSH_RACE,
            "remote advanced during the publication attempt; nothing force-pushed",
            candidate=candidate,
            remote_tip=fresh,
        )
    detail = pushed.stderr.strip() or pushed.stdout.strip() or f"exit {pushed.returncode}"
    return PublishResult(ERROR, f"non-force push/read-back did not publish candidate: {detail}", candidate=candidate, remote_tip=fresh)


def publish(
    repo: str | Path,
    base: str,
    *,
    remote: str = "origin",
    branch: str = "main",
    rebind: bool = False,
) -> PublishResult:
    try:
        repo = Path(repo).expanduser().resolve()
        if not _clean(repo):
            return PublishResult(ERROR, "publication workspace is dirty; preserve and resolve before publication")
        candidate = _rev(repo, "HEAD")
        if not candidate:
            return PublishResult(ERROR, "candidate HEAD could not be established")
        if not _rev(repo, base):
            return PublishResult(ERROR, f"ADMITTED_BASE {base!r} is not available in this repository", candidate=candidate)
        if not _is_ancestor(repo, base, candidate):
            return PublishResult(ERROR, "candidate is not a descendant of ADMITTED_BASE", candidate=candidate)

        changed = _changed_paths(repo, base, candidate)
        if not changed:
            return PublishResult(NO_CHANGE, "candidate has no bounded delta from ADMITTED_BASE", candidate=candidate)

        remote_tip = _fetch(repo, remote, branch)
        if _is_ancestor(repo, remote_tip, candidate):
            return _push_and_readback(repo, candidate, remote, branch, remote_tip)

        if candidate_delta_already_present(repo, base, candidate, remote_tip):
            return PublishResult(
                ALREADY_PRESENT,
                "candidate changed paths already match fresh remote; no push performed",
                candidate=candidate,
                remote_tip=remote_tip,
            )

        if not rebind:
            return PublishResult(
                REMOTE_ADVANCED,
                "fresh remote is not an ancestor of candidate; caller must classify movement before optional --rebind",
                candidate=candidate,
                remote_tip=remote_tip,
            )

        rebound, note = _rebind_once(repo, base, candidate, remote_tip)
        if not rebound:
            return PublishResult(BINDING_CONFLICT, note, candidate=candidate, remote_tip=remote_tip)
        if rebound == remote_tip:
            return PublishResult(ALREADY_PRESENT, note, candidate=candidate, remote_tip=remote_tip)

        moved, move_error = _move_detached_workspace(repo, rebound)
        if not moved:
            return PublishResult(
                ERROR,
                f"rebound commit was created but detached workspace could not move to it: {move_error}",
                candidate=rebound,
                remote_tip=remote_tip,
            )
        return _push_and_readback(repo, rebound, remote, branch, remote_tip)
    except (OSError, RuntimeError) as exc:
        return PublishResult(ERROR, str(exc))


def _emit(result: PublishResult) -> int:
    print(f"PUBLICATION_RESULT={result.result}")
    if result.candidate:
        print(f"CANDIDATE={result.candidate}")
    if result.published_commit:
        print(f"PUBLISHED_COMMIT={result.published_commit}")
    if result.remote_tip:
        print(f"REMOTE_TIP={result.remote_tip}")
    if result.reason:
        print(f"REASON={result.reason}")
    return 0 if result.result in {PUBLISHED, NO_CHANGE, ALREADY_PRESENT} else 1


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repo", default=".")
    parser.add_argument("--base", required=True, help="exact ADMITTED_BASE revision for the candidate")
    parser.add_argument("--remote", default="origin")
    parser.add_argument("--branch", default="main")
    parser.add_argument("--rebind", action="store_true", help="caller already classified remote movement as topology-only")
    args = parser.parse_args(argv)
    return _emit(publish(args.repo, args.base, remote=args.remote, branch=args.branch, rebind=args.rebind))


if __name__ == "__main__":
    raise SystemExit(main())
