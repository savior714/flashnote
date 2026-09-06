# Flashnote Agent Routing

This file is a routing surface, not a second policy owner.

Before changing the repository, read the current versions of:

1. `docs/PRODUCT.md` — product behavior and UX contract.
2. `docs/TECHNICAL.md` — implementation architecture and technical baseline.
3. `docs/DEVELOPMENT.md` — development execution, verification cadence, handoff, concurrency, branch discipline, data safety, and publication contract.

Use current repository/runtime evidence for live state. Treat prior handoffs, remembered SHAs, temporary branches/worktrees, candidate refs, CLI/session topology, and executor-specific mechanics as historical context unless the current task still requires them.

Canonical product, technical, and development authority lives in the documents above.

Coordinator sessions may additionally consult the project's external non-authoritative coordination surface as a continuity aid; detailed coordination/execution policy belongs in `docs/DEVELOPMENT.md`, not here. Local executors do not need access to that surface: the coordinator owns ledger synchronization and executors return structured results.

Do not duplicate detailed policy here. If a development rule needs to change, update its canonical owner instead.
