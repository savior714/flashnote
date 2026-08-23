# Flashnote Technical Baseline

_Status: evolving implementation baseline · 2026-08-23_

This document records technical decisions that shape Flashnote's implementation. Product behavior remains governed by `docs/PRODUCT.md`. Exact dependency patch versions, operational tuning values, and implementation details should remain open until they are needed or verified during implementation.

## 1. Desktop application stack

### Decision

Use **Wails v3** with **Go** for the desktop application shell and native/backend layer.

### Rationale

- Flashnote is a lightweight local-first desktop application for macOS and Windows.
- Wails keeps a system-WebView frontend while allowing local persistence, filesystem integration, backup, export, and OS-facing behavior to live in Go.
- The project is greenfield, so it can start directly on the Wails v3 generation rather than creating immediate v2-to-v3 migration debt.
- While Wails v3 remains prerelease, dependency versions must be pinned deliberately and upstream changes reviewed before upgrades.

### Rejected baseline alternatives

Tauri/Rust, Electron, and separate native macOS/Windows UI implementations are not the current baseline. They should be reconsidered only if implementation evidence shows a material limitation in Wails for Flashnote.

## 2. Frontend

### Decision

Use **Svelte 5 + TypeScript** for the WebView frontend.

### Rationale

- Flashnote benefits from a small component and state-management surface.
- Svelte fits the project's compact desktop UI and single-developer maintenance goals.
- Wails v3 provides a first-class Svelte starter.
- A heavier frontend state framework is not implied by this decision and should not be added without a demonstrated need.

## 3. Rich-text editor

### Decision

Use **Tiptap 3** as the rich-text editor layer, backed by ProseMirror.

### Rationale

- Flashnote needs structured rich text, not Markdown-first live storage.
- Tiptap provides a practical extension layer over ProseMirror without requiring the application to own the full editor framework itself.
- The required MVP vocabulary—paragraphs, headings, lists, task items, quotes, code blocks, dividers, links, images, and inline formatting—fits Tiptap's extension model.
- Paste normalization, image-node behavior, slash-command behavior, and constrained document schema can be implemented while retaining access to lower-level ProseMirror APIs when necessary.
- Svelte integration is supported without making React a dependency of the application UI.

## 4. Canonical rich-text persistence schema

### Decision

Use a **Flashnote-owned, versioned, Tiptap/ProseMirror-compatible JSON schema** for canonical rich-text persistence.

The persisted document shape may remain directly consumable by Tiptap/ProseMirror, but Flashnote—not the editor library—defines which node types, mark types, and attributes are valid canonical data.

Each persisted document carries an explicit schema version. Reads and writes pass through a narrow validation/normalization boundary so unsupported extension data does not silently become durable application state.

### Rationale

- The product contract makes structured rich text canonical and Markdown an export projection.
- Persisting arbitrary editor output would make Tiptap extension details the de facto Flashnote file format.
- A small Flashnote-owned vocabulary keeps data authority independent from incidental editor configuration while avoiding the cost of maintaining a second, fully independent AST.
- Explicit schema versions provide a clear place for deterministic migrations when document semantics evolve.
- The representation should stay close enough to ProseMirror JSON that normal editor load/save does not require a large translation layer.

### Boundary

The initial schema should include only MVP-supported document constructs. New Tiptap extensions do not become persistent schema members merely because they are installed in the editor.

Validation, normalization, and migrations must preserve user content or fail visibly; they must not silently discard unknown consequential document data.

The exact JSON envelope and first schema version will be implemented alongside the first persistence vertical slice rather than expanded into a separate abstract document model now.

## 5. SQLite driver

### Decision

Use **`modernc.org/sqlite`** as Flashnote's Go SQLite driver.

SQLite access should use Go's standard `database/sql` surface unless a narrowly justified lower-level capability is needed.

### Rationale

- The driver is pure Go and does not require CGO, which keeps macOS and Windows build and packaging requirements smaller and more reproducible.
- Flashnote's expected workload is local document CRUD, metadata queries, autosave, and search rather than a throughput-heavy analytical database workload.
- Avoiding a C compiler and CGO toolchain is more valuable for this desktop application than optimizing for the maximum possible raw SQLite throughput before evidence shows a bottleneck.
- The driver exposes SQLite capabilities needed by a local-first application while remaining compatible with the standard Go database abstraction.

### Boundary

This decision chooses the SQLite driver only. It does not yet fix connection-pool settings, WAL/pragmas, transaction ownership, migration tooling, backup mechanics, or the Go application-layer persistence API.

The exact dependency version must be pinned at scaffold time and upgraded deliberately. The bundled SQLite engine version must also be observable in tests or diagnostics so database-runtime upgrades are explicit rather than accidental.

## 6. Persistence ownership boundary

### Decision

The **Go backend exclusively owns SQLite access and persistence semantics**.

The Svelte frontend and Tiptap editor call typed Wails application operations such as create, load, save, move, delete, restore, and search. They do not receive a generic SQL execution API and do not know the database path, schema, transaction boundaries, migration state, WAL settings, or backup mechanics.

Start with a small concrete persistence package behind application-facing Go operations. Do not introduce a formal repository-interface hierarchy until a real second implementation, test seam, or ownership boundary makes that abstraction useful.

### Rationale

- SQLite is the canonical internal authority, so transaction and durability semantics should have one owner.
- Autosave, Trash recovery units, folder deletion, attachment reconciliation, migrations, and backup all need application-level atomicity that should not leak into frontend components.
- Keeping SQL and persistence policy in Go prevents database schema details from spreading through Svelte UI code.
- This keeps the architecture consistent with the Wails + Go choice while avoiding speculative repository abstractions.

### Boundary

Wails bindings expose domain/application operations, not SQL primitives. The frontend may keep transient editor/UI state, but durable state transitions are validated and committed by Go.

The exact package layout, transaction helper shape, connection policy, WAL/pragmas, migration mechanism, and backup implementation remain open until the persistence vertical slice requires them.

## 7. Open technical decisions

The following are intentionally not yet fixed:

- exact Go toolchain and version policy
- exact Wails v3 prerelease/stable pin and upgrade policy
- exact Node/pnpm/TypeScript toolchain versions
- SQLite connection policy, WAL/pragmas, migration mechanism, and backup implementation
- autosave scheduling and durability mechanics
- attachment ingest/storage implementation details
- search indexing/tokenization implementation
- test stack and native packaging/update strategy

These should be grilled only when the decision is materially expensive to reverse or is needed to implement the next vertical slice.