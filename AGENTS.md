# Flashnote Agent Routing

This file is a routing surface, not a second policy owner.

Before changing the repository, read the current versions of:

1. `docs/PRODUCT.md` — product behavior and UX contract.
2. `docs/TECHNICAL.md` — implementation architecture and technical baseline.
3. `docs/DEVELOPMENT.md` — development execution, verification cadence, handoff, concurrency, branch discipline, data safety, and publication contract.

Use current repository/Git/runtime evidence for live state; it always outranks any external coordination or continuity material. Treat prior handoffs, remembered SHAs, temporary branches/worktrees, candidate refs, CLI/session topology, and executor-specific mechanics as historical context unless the current task still requires them.

`docs/DEVELOPMENT.md` owns the development lifecycle and is the only execution contract: fresh `origin/main` → isolated worktree + task branch → bounded implementation → nearest faithful proof → JIT fetch/reconcile → non-destructive publication → remote read-back → workspace cleanup. External coordination ledgers/inboxes are not required by the normal path and never override live Git state.

Canonical product, technical, and development authority lives in the documents above. Do not duplicate detailed policy here. If a development rule needs to change, update its canonical owner instead.
