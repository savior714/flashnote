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

## 5. Open technical decisions

The following are intentionally not yet fixed:

- exact Go toolchain and version policy
- exact Wails v3 prerelease/stable pin and upgrade policy
- exact Node/pnpm/TypeScript toolchain versions
- SQLite driver, ownership boundary, migration mechanism, and backup implementation
- autosave scheduling and durability mechanics
- attachment ingest/storage implementation details
- search indexing/tokenization implementation
- test stack and native packaging/update strategy

These should be grilled only when the decision is materially expensive to reverse or is needed to implement the next vertical slice.
