# Flashnote Development Operating Contract

_Status: canonical execution/publication contract · 2026-09-24_

This document owns Flashnote's development execution lifecycle, verification cadence, concurrency, handoff, and `origin/main` publication rules. The repository itself is the execution authority: the canonical task lifecycle (§6) runs entirely on Git state and requires no external coordination control plane (§12). Product behavior remains owned by `docs/PRODUCT.md`; implementation architecture remains owned by `docs/TECHNICAL.md`. A root `AGENTS.md`, when present, is routing only and must not duplicate this contract.

## 1. Operating priority: current product work first

Flashnote is in active personal-use development. The default is **build/repair first with a correctness gate**, not governance-first or release-qualification-first.

Use this priority order:

1. correctness, user-data safety, and intended product semantics;
2. smallest **root-cause-complete** change that leaves the implementation clearer than before;
3. nearest faithful proof needed for that change;
4. ordinary publication and return to real use.

Do not reopen already-closed MVP audits, packaging/signing/notarization, broad release qualification, dependency upgrades, or speculative infrastructure unless a current defect, security/compatibility need, or explicit user decision reopens that scope.

For live repository/runtime facts, current direct evidence outranks old handoffs, remembered SHAs, prior task state, and historical acceptance results. Prior decisions remain useful only where current evidence has not superseded them. Live repository/Git state always outranks any external coordination or continuity material (§12); such material may inform but never overrides it.

## 2. Task shape and semantic convergence

A bounded task should be one self-contained semantic state transition, not an arbitrary minimum number of lines or files.

Prefer the smallest change that fully removes the demonstrated root cause. A smaller diff is **not** better when it leaves the old semantic path in place and adds another special case, fallback, wrapper, adapter, duplicate resolver/state owner, or parallel implementation.

When a change materially affects semantic ownership:

- identify the canonical owner after the change;
- remove duplicate, obsolete, or superseded paths when safe;
- justify any temporary coexistence with a concrete current consumer or migration dependency;
- record the exit/removal condition for temporary coexistence;
- do not add a new registry, state machine, checker, manifest, framework, or policy layer merely to enforce this rule.

Compatibility is not a sufficient justification by itself. Preserve compatibility only for an identified current dependency or external contract.

## 3. Parallel work follows architecture boundaries

Flashnote allows parallel investigation, editing, build, and proof. Parallelism is organized by **independently convergent architecture/semantic ownership boundaries**, not by file count, frontend/backend/test layers, or the number of available executors.

A good parallel unit owns one coherent concern end-to-end and may touch UI, Go, persistence, tests, and docs when they belong to that concern. Avoid splitting one semantic change horizontally across layers when the units still depend on each other's reasoning or completion.

Before parallelizing, inspect the current repository and dependency/ownership graph. Path-disjointness helps but does not prove semantic independence. Shared schema, public interfaces, build/runtime configuration, canonical contracts, persistence semantics, or common state owners can couple otherwise different files.

Preserve unrelated foreign working state. Do not reset, clean, stash, restore, move, or delete another task's work merely to simplify the current task.

The collision unit for task issuance is `SEMANTIC_OWNER`. Before starting or parallelizing a mutating task, check active semantic owners from live Git state — recent `origin/main` history, current worktrees/refs, and the canonical contracts each task touches. An already-active semantic owner normally blocks another mutating task for that owner, even when file paths look disjoint. No external reservation ledger or registry is consulted or required for this check; the check is judgment against live repository evidence, and a genuine tie-break that repository evidence cannot resolve is escalated, not silently co-issued.

## 4. Verification cadence: nearest faithful proof

Verification should be proportional to the demonstrated risk.

Default loop:

1. reproduce or otherwise establish the current problem;
2. implement the root-cause-complete change;
3. run the **nearest faithful proof** that can falsify the intended fix;
4. add or change regression coverage only when it protects a real contract or reproduced failure;
5. stop when additional verification cannot materially change the claim.

Changes to `scripts/git/workspace.py`, `scripts/git/publish.py`, or the staged-scope gate use `task git:contract-test` as their nearest regression proof. The suite uses Python stdlib `unittest` plus temporary real Git repositories/worktrees; it does not add a Python test dependency or require the broad product suite for a Git-mechanics-only change.

Do not run broad native/package/release suites after every ordinary change. Full/canonical release qualification is a separate future frontier and should begin only when external distribution/release preparation is explicitly reopened.

Behavioral PASS is necessary but not always sufficient. If a change alters semantic ownership or implementation shape, completion also requires lightweight structural-convergence evidence: one clear canonical owner, obsolete/parallel paths removed or justified, and any temporary coexistence tied to a real consumer plus an exit condition.

Treat `UNKNOWN` / `UNVERIFIED` as such; never upgrade it to `HEALTHY` merely because code, configuration, a secret name, a health endpoint, or a historical test exists.

Tests are reviewed as production code. Remove or consolidate brittle, implementation-coupled, semantically duplicate, stale legacy-preserving, or unnecessarily broad tests when they no longer protect a meaningful contract.

### Native/UI data safety

All native/UI/acceptance/destructive/state-mutating automation must remain isolated from real user data. On macOS the default isolation mechanism is a fresh temporary `HOME`, producing the test database at:

`<temporary HOME>/Library/Application Support/Flashnote/flashnote.db`

Never run such automation against the normal Flashnote data directory or real `flashnote.db`. A real-use process may use normal user data; automated mutating processes may not.

## 5. Handoff continuity: preserve semantics, not mechanics

A previous executor's branch, worktree, candidate ref, temporary path, CLI, session topology, launcher variables, tool choice, and similar mechanics are historical execution traces, not automatically inherited requirements.

Before continuing prior work, normalize it into:

- semantic result / intended state transition;
- valid proof and what it actually establishes;
- unresolved blockers or residuals;
- current repository/runtime evidence that must be rechecked.

Then derive the next execution mechanics from current repository truth. Reuse old mechanics only when they are still necessary for correctness, safety, preservation, proof, or publication.

Local handoffs are executor-neutral by default. They should be repository-aware and describe `OUTCOME`, `PRESERVE`, `PROOF`, and `ESCALATE ONLY IF` without assuming a specific coding agent, binary path, launcher topology, or permission syntax unless that capability is intrinsic to the task.

When reporting a completed or blocked development session, `FRICTION_OBSERVED` may contain 0–3 concrete friction candidates for later consideration. Reporting friction does not automatically open a new task.

## 6. Canonical task lifecycle: isolated workspace, direct-main publication

Flashnote uses direct-main single-trunk development. Feature branches and pull requests are not the ordinary workflow. The default mutation workspace is a **detached transient worktree** created from fresh `origin/main`; a named branch/ref is created only when current evidence establishes a need beyond workspace isolation itself.

Every mutation task runs this lifecycle:

1. **Fresh remote authority** — fetch `origin` and admit the resulting `origin/main` as the task base; record it (`ADMITTED_BASE`).
2. **Bounded scope and semantic owner** — bound the task to one semantic transition and identify its `SEMANTIC_OWNER` (§2, §3).
3. **Isolated workspace** — use `scripts/git/workspace.py create` (or an exactly equivalent bounded Git operation when the helper itself is under repair) to create one clean detached worktree at the freshly admitted revision. Do not mutate directly in a shared checkout carrying unrelated dirty or foreign state.
4. **Bounded implementation** — make the smallest root-cause-complete change (§2). Mutating formatters/autofixers/codemods receive only the explicit task-owned path set.
5. **Explicit staging scope** — stage only explicit task-owned paths. Before a mutation commit, set `TASK_OWNED_PATHS` and run `task git:staged-scope-check`; the staged set must be a subset of that declared set.
6. **Nearest faithful proof** — run the cheapest proof that can falsify the change (§4).
7. **Just-in-time reconcile** — immediately before publication, fetch `origin` again and classify intervening movement by task meaning, proof validity, and publication topology (§7); reconcile only the affected boundary.
8. **Non-destructive publication** — use `scripts/git/publish.py --base <ADMITTED_BASE>` for the Git-mechanical publication path (§8). Ordinary publication is one non-force update of `refs/heads/main`; force-push and history rewrite are prohibited.
9. **Remote read-back** — re-read `origin/main` and prove the exact published task commit is contained in it. A local commit or successful push command alone is not publication proof.
10. **Published-only cleanup** — use `scripts/git/workspace.py cleanup <workspace>` only after publication/read-back. The helper removes exactly one helper-managed detached worktree only when its clean current HEAD is contained in fresh `origin/main`; dirty, unpublished, active-operation, unregistered, fetch-failed, or otherwise unknown state is preserved.

Local implementation completion is never `COMPLETE` / `PUBLISHED`; only publication, read-back, and applicable cleanup establish that terminal result. A task that stops earlier reports the precise non-publication disposition and resume condition below.

### Workspace and commit discipline

- Branchless detached worktrees are the default isolation carrier. A named branch has no default lifecycle role and is created only for a concrete current need that a detached worktree cannot satisfy.
- Do not create branches for naming, experimentation, routine review, publication mechanics, or sub-tasks; do not stack or recursively fork temporary branches.
- Ordinary bounded staging is explicit path enumeration: use `git add -- <path>...`. `git add -A`, `git add .`, and wildcard pathspec staging are not ordinary mutation steps because they can sweep foreign state.
- `TASK_OWNED_PATHS` is mandatory for a mutation commit. `task git:staged-scope-check` is read-only, prints the exact staged set, fails closed when `TASK_OWNED_PATHS` is absent, and refuses a staged path outside the declared set.
- A foreign staged path is a stop-and-report event. Do not automatically reset, restore, clean, stash, or otherwise rewrite foreign state to make the gate pass.
- A mutating formatter, autofixer, or codemod receives only task-owned paths or an equivalently bounded mechanically derived set. Whole-repository read-only checks remain allowed.
- `scripts/git/workspace.py` owns only fresh admission, detached-worktree creation/inspection, and published-only cleanup. It owns no semantic admission, task identity, queue/registry, owner token, frontier claim, publication, or unpublished-candidate disposal.
- If isolation or ownership cannot be established without touching foreign state, stop and report `WORKSPACE_DECISION_NEEDED` with the exact conflict and smallest decision required.
- At task completion report the admitted base, workspace used, publication result, and whether the task-owned workspace was cleaned or deliberately preserved.

Keep two concepts separate:

- **`SEMANTIC_READY`**: the bounded semantic delta, relevant base context, proof owner/criterion, and proof result are known.
- **`PUBLISHABLE`**: fresh remote authority additionally proves there is an immediate non-force fast-forward path from current `origin/main` to the exact candidate to publish, with candidate integrity/direct-impact still valid.

Remote ref movement alone does not invalidate completed semantic work or reusable proof.

When the user authorizes a bounded repository mutation, that authorization includes the result's ordinary publication unless the user explicitly says `LOCAL_ONLY`, `no push`, `candidate only`, `commit only`, `PR 전까지만`, or gives an equivalent publication restriction. Do not ask for publication permission again after an already-authorized ordinary mutation task.

Semantic authorization and runtime permission are distinct. An already-authorized bounded mutation's ordinary publication remains semantically authorized; an OpenCode/runtime `ask` prompt is a mechanical permission gate, not a reopening of that semantic decision. Do not add a second conversational confirmation when the runtime itself can surface its permission request. `git push*` remains `ask` in runtime permission config and is not broadened by this rule. Rebase/checkout are not ordinary Flashnote publication mechanics and remain ask-gated.

A local or temporary candidate is not terminal success for a publication-intended task. Normal success ends with `COMPLETE / PUBLISHED`; otherwise report the precise non-publication disposition and preserve reusable work.

Never present `SEMANTIC_READY` as `COMPLETE`/`PUBLISHED`. On a publication stop, report `DISPOSITION: SEMANTIC_READY / NOT PUBLISHED` with the reusable semantic delta/proof, the exact resume condition, and the next semantic action. Do not require a candidate ref or executor-specific exact command when one is not intrinsically needed to resume.

## 7. Remote movement and just-in-time final binding

At task start, read current `origin/main` as an evidence anchor. The anchor records where work began; it does not freeze repository truth.

Evidence remains bound to the exact revision actually observed when it was gathered. Never relabel old evidence as current merely because it is still reusable; re-observe fresh authority only when the next decision materially depends on current state.

If fresh upstream already satisfies the exact bounded outcome, stop duplicate mutation after the smallest faithful semantic confirmation. Mechanical candidate-delta containment is a Git fact, not proof of task identity or broader semantic equivalence; the caller owns that semantic closure decision.

Immediately before publication, read live `origin/main` again and classify intervening movement by **semantic/proof impact**, not merely by SHA inequality or textual conflicts.

- If the existing candidate is already a fast-forward descendant of current `origin/main`, publish that candidate after final integrity checks; do not rematerialize it.
- If remote movement is topology-only for this task, preserve the semantic delta and reusable proof and perform only the minimum necessary **just-in-time final binding** to current `origin/main`.
- If intervening work changes the task's semantic owner, contract, mutation meaning, or proof validity, inspect the direct impact and rerun only the proof whose validity could have changed. Stop when correctness cannot be established safely.
- Do not rebuild, rebind, or recreate a semantically unchanged candidate merely because another writer published first.

A just-in-time binding is publication preparation, not history repair. Do not use merge commits, force-pushes, or automatic chains of rebase/cherry-pick/replay as contention recovery.

If `origin/main` advances again after one topology-only final binding attempt, preserve the semantic result/candidate and stop the rematerialization loop. Re-enter from fresh repository truth rather than repeatedly recreating candidates in the same task.

Topology classification for the movement above binds as follows: `TOPOLOGY_ONLY_OR_DISJOINT` means remote movement with no semantic/proof impact on this task (publish directly or apply minimal JIT binding); `SEMANTIC_OVERLAP` means intervening work changed this task's semantic owner, contract, or mutation meaning; `PROOF_OWNER_MOVED` means the recorded proof's owner, criterion, or validity moved even when the delta text looks intact (rerun only the affected proof); `PUBLICATION_TOPOLOGY_CONFLICT` means the candidate cannot advance `origin/main` fast-forward without binding mechanics despite intact semantics (single binding attempt, then stop per above); `UNKNOWN` means impact cannot be established from available evidence (treat as unverified, never coerce). These names only label §7/§8 outcomes; they create no second framework.

## 8. Publication critical section

Semantic development stays parallel. Publication is the short final integration boundary; Flashnote does **not** add a host-local publication lease/lock by default because repeated measured contention has not established that cost.

Immediately before publishing:

1. read live `origin/main`;
2. establish candidate integrity and let the caller classify direct semantic/proof impact of intervening changes;
3. invoke `scripts/git/publish.py --base <ADMITTED_BASE>`; the helper owns Git mechanics only and never decides task identity, semantic equivalence, or proof sufficiency;
4. if fresh remote is no longer an ancestor of the candidate, the default result is `REMOTE_ADVANCED`; only after the caller has independently classified the movement as topology-only may it explicitly request one `--rebind`;
5. perform at most that one full-delta rebind, one ordinary non-force push, and no automatic retry/rebind loop;
6. read remote again and prove the exact published commit is contained in live `origin/main`.

The publication helper may report `PUBLISHED`, `NO_CHANGE`, `ALREADY_PRESENT`, `REMOTE_ADVANCED`, `BINDING_CONFLICT`, `PUSH_RACE`, or `ERROR`. These are mechanical facts. In particular, `ALREADY_PRESENT` means only that the candidate's changed paths already match fresh remote; any higher semantic conclusion remains with the caller. A caller-authorized rebind uses a helper-owned scratch worktree so an apply conflict leaves the original candidate untouched; after a successful rebind the detached task workspace advances to the rebound commit so publication and later published-only cleanup refer to the same representation.

For Web/GitHub-API mutation spanning multiple files, prepare the complete file set first, build one Git tree, create one task commit with the live `main` as its sole parent, then perform one non-force ref update. Do not advance `main` once per file.

Do not introduce a lock, lease, daemon, queue, merge queue, or durable publication state machine by default. Explicit publication single-flight/serialization machinery is admitted only after repeated measured contention among otherwise independent writers causes material waste such as recurring non-fast-forward failures, repeated final rebinding/candidate recreation, publication starvation, or unnecessary proof reruns.

## 9. CI, automation, and repository-side defense

CI is verification-first. A workflow that writes to `main` is a publication producer and must follow the same bounded-candidate, fresh-authority, non-force, and read-back contract.

Prefer server-side defense in depth when available:

- require linear history on `main`;
- block force pushes;
- avoid requiring a pull request solely to obtain those protections while Flashnote remains direct-main.

Server rules do not replace semantic-overlap checks, proof validity, candidate integrity, or fresh remote authority. If protection/ruleset state has not been directly read, report it as `UNKNOWN/UNVERIFIED`, not healthy.

## 10. Review standard

Review implementation results as strict pair programming, not as a pass/fail formality. Actively look for:

- root cause left partially open;
- unnecessary complexity or abstraction;
- duplicate/parallel semantic owners;
- stale fallback/compatibility paths;
- over-broad or brittle tests;
- missing regression proof for a real failure boundary;
- proof that is much broader or more expensive than the claim requires.

Use `BLOCKING`, `SHOULD FIX`, and `NICE TO HAVE` when severity improves actionability. Do not block forward progress on polish that cannot materially improve correctness, safety, semantic convergence, or maintainability.

## 11. Post-MVP personal-use operating mode

Flashnote is currently a **personal program used directly from the source checkout**. DMG/PKG distribution, Developer ID signing, notarization, Gatekeeper hardening, public release publication, and updater work are **DEFERRED / INACTIVE**. Do not generate, recommend, or automatically validate a DMG for the normal personal-use loop. Reopen distribution work only after an explicit decision to distribute Flashnote outside the current personal-use path.

The canonical real-use launcher is `./Flashnote.command`. It must start one stable source-built application process, not `wails3 dev`. Watch/HMR/rebuild relaunches are development lifecycle events: they may replace the frontend or process without traversing Flashnote's normal note-transition or window-close save flush. They therefore must not be the lifecycle boundary for real notes.

`wails3 dev` remains available only for active coding/debugging. Do not use it as the personal note-taking launcher while source files may change, especially while multiple development sessions are working concurrently.

The default development loop is:

1. run the current source through the stable personal-use launcher;
2. capture the first concrete defect or friction that materially interferes with personal use;
3. reproduce and bound that problem against current `origin/main` without touching real user data from automation;
4. implement the smallest root-cause-complete fix;
5. run the nearest relevant proof in isolation;
6. publish the bounded result under this contract and return to real use.

Use the question **“Does this materially interfere with using Flashnote now?”** as the first frontier filter. Cosmetic or speculative improvements may be recorded, but they do not preempt an observed user-blocking defect.

A newly observed data-loss or durability contradiction supersedes prior optimistic acceptance status for that exact failure family. Do not treat earlier GREEN package/runtime evidence as proof that a new real-use autosave failure is closed.

Release-package and DMG workflows may remain in the repository as historical/manual evidence owners, but they must not run automatically on ordinary `main` pushes while distribution is inactive. Dependency/toolchain upgrades are not frontiers by themselves; open them only when required by an observed defect, security issue, or compatibility problem.

## 12. Execution authority and legacy coordination surface

The repository owns the execution lifecycle. Authority for judging current task state, in priority order:

1. live repository/Git state (`origin/main`, current worktrees/branches, commit history);
2. runtime/artifact evidence when the claim involves runtime behavior;
3. the canonical repository specifications (`docs/PRODUCT.md`, `docs/TECHNICAL.md`, this document).

The normal task lifecycle (§6–§8) must not require any external coordination control plane: no Drive/Active-Coordination surface, `READY` registration, `IN_FLIGHT` ledger, persistent semantic-owner reservation store, Work Inbox, claim/lease mechanism, relay, Executor Report Inbox, completion transport, revision/cursor synchronization, or heartbeat/daemon/scheduler. A task missing any such state reconstructs everything it needs from live Git (§6 step 1) and proceeds.

External coordination or continuity material may exist and may be consulted as a supplementary historical aid at best. It never overrides live Git state, never gates publication, and never reopens a `CLOSED` scope. Legacy coordination machinery may still physically exist in or around this repository; its footprint is a migration inventory, not a contract input. Until an explicit follow-up task removes a piece, it stays untouched and inactive — but no canonical rule may add a new normal-path dependency on it, and no compatibility/shadow/fallback coordination path may be introduced.

These invariants survive as repository development rules, independent of any ledger:

- `SEMANTIC_OWNER` is the collision unit; file disjointness never proves semantic independence (§3).
- Never issue parallel mutations against the same active semantic owner (§3).
- Evidence-first verification with the nearest faithful proof (§4); `UNKNOWN` / `UNVERIFIED` is never promoted to proven, healthy, or published.
- Remote revision movement alone is not semantic invalidation (§7).
- Semantic freshness (the delta still means the same thing on the current base), proof freshness (the recorded proof still falsifies the current candidate), and publication freshness (an immediate non-force fast-forward path exists right now) are distinct; none implies the others.
- Absence of a task from any record is not proof that no concurrent or unpublished work exists; check live Git.
- A blocker must state its exact blocked boundary, what remains possible, and the concrete resume condition.
- A `CLOSED` scope is not reopened without new direct evidence or a change in a governing decision (§1, §11).
