# Flashnote Development Operating Contract

_Status: canonical execution/publication contract · 2026-08-24_

This document owns Flashnote's development execution, concurrency, and `origin/main` publication rules. Product behavior remains owned by `docs/PRODUCT.md`; implementation architecture remains owned by `docs/TECHNICAL.md`.

## 1. Core model: parallel work, serialized main finalization

`origin/main` is the canonical append-only development log. Flashnote uses direct-main single-trunk development; feature branches and pull requests are not the default workflow.

Independent tasks may investigate, edit, build, and test concurrently. Development is **not** globally single-writer. The serialization point is the short finalization interval in which a task is rebound to current `origin/main`, creates its exact task commit, and attempts one non-force publication.

The goal is to preserve parallel throughput without allowing concurrent work to manufacture divergent `main` history that later needs merge/rebase/cherry-pick recovery.

## 2. Publication producers

A **publication producer** is anything that can move `refs/heads/main`, including:

- a local developer or local coding agent;
- Web GPT or another GitHub-API client;
- GitHub Actions or another CI bot;
- a scheduled automation or external service.

Do not reason only about local sessions. Every publication producer follows the same exact-base, single-commit, non-force finalization contract.

## 3. Parallel execution boundary

Parallel work is allowed only when the tasks are genuinely independent in mutation surface, direct contract ownership, and acceptance evidence.

During normal local work:

- keep tracked edits uncommitted for as long as practical;
- do not use commits on local `main` as routine checkpoints while another producer may advance remote `main`;
- preserve unrelated foreign working state; do not reset, stash, clean, restore, or otherwise reclaim another task's work;
- long builds, tests, research, review, and preparation may overlap;
- linked worktrees may be used when they materially improve isolation, but are not a mandatory control plane.

Path-disjointness is necessary but not always sufficient. If an intervening change modifies a shared schema, build/runtime configuration, public interface, canonical contract, or other semantic owner that can invalidate the task, treat it as overlapping even when file paths differ.

## 4. Freshness lifecycle

At task admission, read current `origin/main` and remember that commit as the task's evidence anchor. The anchor records where the task started; it does not freeze `main` for the duration of the work.

Before finalization, fetch/read live `origin/main` again and inspect every intervening change relevant to the task.

- If live `main` is not a descendant of the admission anchor, STOP.
- If intervening work overlaps the task mutation/commit surface or directly changes its contract/evidence meaning, preserve the candidate and STOP.
- If live `main` advanced monotonically and the intervening work is independently established as disjoint, refresh to that descendant with ordinary fast-forward semantics while preserving the task changes, then rerun the nearest verification whose validity could have changed.
- Never infer semantic independence merely because Git reports no textual conflict.

## 5. Finalization is the serialization point

Immediately before creating the task commit:

1. read/fetch live `origin/main`;
2. establish that any intervening change is an allowed disjoint descendant;
3. require the task's final commit to be based directly on that live `main`;
4. create exactly one bounded task commit;
5. attempt exactly one non-force update of `refs/heads/main` to that exact commit;
6. read/fetch remote again and prove that the exact task commit is contained in live `origin/main`.

Keep the interval between commit creation and publication as short as possible. Commit creation is part of publication finalization, not a long-lived reservation of history.

If another producer wins the race after the task commit is created, the non-force update must fail. Preserve the exact candidate and report `NOT_PUBLISHED`; do not repair ancestry inside the same task.

## 6. No topology-repair publication

Normal development must not turn publication contention into history integration.

A task must not respond to a non-fast-forward or stale-base condition by creating a merge commit, rebasing, cherry-picking/replaying, squashing, resetting shared state, or force-pushing merely to make the candidate publishable.

A multi-parent commit is not a valid contention-recovery artifact for normal direct-main development. If publication would require such an operation, the current task stops with the candidate preserved. Any later recovery is a separately admitted task derived from current repository truth, not an automatic continuation of the failed publication.

## 7. Web/GitHub API mutations

Web-based mutation differs from a local working tree because a normal file-update API may create a remote commit immediately.

For one bounded task that changes multiple files, do not advance `main` once per file. Prepare the complete file set first, build one Git tree, create one commit whose sole parent is the live `main` observed for finalization, then perform one non-force ref update.

If `main` moves before that ref update, publication fails closed. Do not rebuild or replay automatically in the same task.

This keeps one bounded Web task equivalent to one local task commit and minimizes the remote-advance window seen by local work.

## 8. CI and automation publishers

A CI workflow that writes to `main` is a publication producer, not merely a verifier. Such workflows must:

- publish only a bounded, already-validated candidate;
- verify that live `main` is still the exact expected base immediately before commit/publication;
- create at most one task commit for that candidate;
- use non-force publication;
- stop rather than merge/rebase/retry when the expected base has moved;
- prove exact post-publication containment.

Prefer verification-only CI unless automatic source publication is materially necessary.

## 9. Server-side defense in depth

Repository policy should enforce **linear history** and **block force pushes** on `main` when available. Do not require a pull request merely to obtain these protections; Flashnote remains direct-main by default.

Server rules are defense in depth. They do not replace task freshness, semantic-overlap checks, exact commit identity, or non-force publication.

## 10. Escalation path

Do not introduce a publication lock, lease, daemon, queue, or branch/PR control plane by default.

Start with optimistic parallel work plus exact-base finalization. If repeated measured publication races among otherwise independent tasks become a material throughput loss, the next escalation is isolated candidate worktrees/refs with a deliberately serialized integration lane. Traditional PR/merge-queue or stacked-PR workflows are later options only if the scale of concurrent development justifies their ceremony.

The system should optimize for productive parallel work while keeping `origin/main` linear, directly explainable, and free of self-created topology recovery.