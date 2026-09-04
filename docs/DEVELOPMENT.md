# Flashnote Development Operating Contract

_Status: canonical execution/publication contract · 2026-09-04_

This document owns Flashnote's development execution, verification cadence, concurrency, handoff, and `origin/main` publication rules. Product behavior remains owned by `docs/PRODUCT.md`; implementation architecture remains owned by `docs/TECHNICAL.md`. A root `AGENTS.md`, when present, is routing only and must not duplicate this contract.

## 1. Operating priority: current product work first

Flashnote is in active personal-use development. The default is **build/repair first with a correctness gate**, not governance-first or release-qualification-first.

Use this priority order:

1. correctness, user-data safety, and intended product semantics;
2. smallest **root-cause-complete** change that leaves the implementation clearer than before;
3. nearest faithful proof needed for that change;
4. ordinary publication and return to real use.

Do not reopen already-closed MVP audits, packaging/signing/notarization, broad release qualification, dependency upgrades, or speculative infrastructure unless a current defect, security/compatibility need, or explicit user decision reopens that scope.

For live repository/runtime facts, current direct evidence outranks old handoffs, remembered SHAs, prior task state, and historical acceptance results. Prior decisions remain useful only where current evidence has not superseded them.

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

## 4. Verification cadence: nearest faithful proof

Verification should be proportional to the demonstrated risk.

Default loop:

1. reproduce or otherwise establish the current problem;
2. implement the root-cause-complete change;
3. run the **nearest faithful proof** that can falsify the intended fix;
4. add or change regression coverage only when it protects a real contract or reproduced failure;
5. stop when additional verification cannot materially change the claim.

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

## 6. Publication states: `SEMANTIC_READY` is not `PUBLISHABLE`

Flashnote uses direct-main single-trunk development. Feature branches and pull requests are not the default workflow.

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

Immediately before publication, read live `origin/main` again and classify intervening movement by **semantic/proof impact**, not merely by SHA inequality or textual conflicts.

- If the existing candidate is already a fast-forward descendant of current `origin/main`, publish that candidate after final integrity checks; do not rematerialize it.
- If remote movement is topology-only for this task, preserve the semantic delta and reusable proof and perform only the minimum necessary **just-in-time final binding** to current `origin/main`.
- If intervening work changes the task's semantic owner, contract, mutation meaning, or proof validity, inspect the direct impact and rerun only the proof whose validity could have changed. Stop when correctness cannot be established safely.
- Do not rebuild, rebind, or recreate a semantically unchanged candidate merely because another writer published first.

A just-in-time binding is publication preparation, not history repair. Do not use merge commits, force-pushes, or automatic chains of rebase/cherry-pick/replay as contention recovery.

If `origin/main` advances again after one topology-only final binding attempt, preserve the semantic result/candidate and stop the rematerialization loop. Re-enter from fresh repository truth rather than repeatedly recreating candidates in the same task.

## 8. Publication critical section

Semantic development stays parallel; serialize only the short final publication critical section for writers targeting the same shared ref.

Immediately before publishing:

1. read live `origin/main`;
2. establish candidate integrity and direct semantic/proof impact of intervening changes;
3. perform at most the minimum necessary JIT final binding;
4. create the exact bounded task commit directly from the admitted live base;
5. perform one non-force fast-forward update of `refs/heads/main`;
6. read remote again and prove the exact task commit is contained in live `origin/main`.

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
