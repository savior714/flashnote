# Flashnote Technical Baseline

_Status: evolving implementation baseline · 2026-08-26_

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

## 7. SQLite schema migrations

### Decision

Use **versioned SQL migration files embedded in the Go application with a minimal application-owned migration runner**.

Schema migrations are packaged into the application binary with Go's `embed` support and applied in deterministic version order during database startup. SQL remains the default representation for schema changes. A narrowly scoped Go migration hook may be added only when a data transformation cannot be expressed safely and clearly in SQL alone.

### Rationale

- Flashnote has one application-owned local database, so a separate migration CLI or server-oriented migration framework adds little value.
- Embedding migrations keeps the executable and the schema evolution authority coupled, which simplifies macOS and Windows packaging and recovery.
- Application ownership makes it straightforward to enforce Flashnote-specific safety behavior such as a pre-migration backup and blocking startup when migration cannot be completed safely.
- Plain versioned SQL keeps schema history readable without introducing migration-framework-specific abstractions.

### Safety boundary

Before a schema-changing migration, create a transactionally consistent safety backup when appropriate. Apply each migration transactionally where SQLite permits it, and advance the recorded schema version only after successful completion.

If a required migration fails, preserve the existing database and backup evidence and stop normal application startup with a visible recovery error. Do not silently continue against a partially upgraded or unknown schema, and do not discard user data to recover automatically.

Migration version identity must be monotonic and immutable once shipped. Existing migration files are not rewritten after release; corrections are introduced as new migrations.

## 8. SQLite runtime and connection policy

### Decision

Use **WAL journal mode with `synchronous=NORMAL`**, enable foreign-key enforcement on every database connection, use a bounded busy timeout, and keep the Go connection pool deliberately conservative and oriented around Flashnote's effectively single-writer workload.

Retain SQLite's default WAL auto-checkpoint behavior initially. Do not introduce an application-owned checkpoint scheduler or aggressive pool tuning without measured contention, latency, or durability evidence.

### Rationale

- WAL allows readers to continue while autosave or other writes are committed, which fits a document editor that reads note lists and search state while persisting edits.
- `synchronous=NORMAL` in WAL mode provides a practical durability/latency balance for frequent local autosave while stronger failure recovery remains supported by explicit flush points, backups, and migration safety snapshots.
- Foreign-key enforcement protects relational invariants such as note/folder and attachment metadata relationships.
- A bounded busy timeout is preferable to immediate transient lock failures, but persistence failures must still surface once the bounded wait is exhausted rather than retrying indefinitely.
- Flashnote has one application process and one canonical database owner, so a large general-purpose connection pool provides little value and can increase write-contention complexity.

### Boundary

Connection initialization must apply and verify required pragmas rather than assuming process-global SQLite state. Runtime diagnostics or tests should make the effective SQLite version, journal mode, synchronous mode, foreign-key setting, and connection policy observable.

Exact pool counts, busy-timeout duration, WAL auto-checkpoint threshold, and explicit checkpoint timing remain implementation-tuning values. Start from conservative values and change them only with evidence from the real autosave/search workload.

## 9. SQLite backup primitive

### Decision

Use the **SQLite Online Backup API** through `modernc.org/sqlite` as Flashnote's canonical database snapshot primitive.

Backups are created from the live database into a temporary destination database using the Online Backup API. The copy may be stepped incrementally so the source database is only read-locked during individual backup steps rather than for the full backup duration. After successful completion, validate the destination as appropriate and atomically promote the completed temporary snapshot into the rolling-backup set.

### Rationale

- The Online Backup API is designed for transactionally consistent snapshots of a live SQLite database and avoids fragile raw file-copy behavior around WAL state.
- Incremental stepping limits how long the live source database is held for each read phase, which fits a background safety mechanism in an interactive editor.
- `modernc.org/sqlite` exposes backup lifecycle operations including `NewBackup`, `Step`, `Remaining`, `PageCount`, `Commit`, and `Finish`, so Flashnote can implement this without introducing another database library or external CLI.
- A temporary destination followed by successful finalization prevents a partial or interrupted backup from being mistaken for a valid recovery snapshot.

### Boundary

This decision selects the backup primitive only. Backup cadence, retention count, triggering conditions, attachment backup policy, and storage-budget thresholds remain implementation or product-tuning decisions.

Backup failure must not corrupt or replace the live canonical database. Migration safety snapshots and ordinary rolling backups may share the same Online Backup primitive while retaining different lifecycle and retention policies.

## 10. Autosave ownership and durability boundary

### Decision

The **frontend owns the current unsaved editor draft and debounce scheduling; Go owns durable persistence commits**.

Tiptap/Svelte tracks the latest in-memory document state and whether it differs from the last acknowledged durable revision. Ordinary typing coalesces through a frontend debounce before calling a typed Wails save operation. The Go backend validates the Flashnote document schema and commits the requested revision transactionally to SQLite before acknowledging success.

Important transitions bypass or drain the ordinary debounce and request an explicit flush. These transitions include switching away from the current note, window close, app quit, and any other lifecycle boundary where losing the latest in-memory edit would violate the product contract.

### Rationale

- The editor is the natural owner of the actively edited in-memory draft; mirroring a second pending editor buffer in Go would create competing transient authorities.
- Debouncing in the frontend avoids IPC and SQLite work on every keystroke while keeping save scheduling close to the edit stream that produces it.
- Go remains the single owner of persistence semantics, validation, transactions, and durable success/failure acknowledgement.
- Explicit transition flushes make lifecycle behavior independent from the ordinary typing debounce interval.
- Separating pending draft state from acknowledged durable state enables the required persistent save-failure indication and close guard without adding a normal visible Saved indicator.

### Concurrency and failure boundary

Save requests must carry enough revision identity to prevent an older completion or retry from being mistaken for persistence of a newer draft. A successful backend acknowledgement advances the frontend's durable revision only for the revision actually committed.

If persistence fails, the frontend retains the latest in-memory draft, keeps the note dirty, surfaces the persistent non-modal save-failure state defined by the product contract, and may retry in a bounded/coalesced manner. Retries must not overwrite a newer draft with stale content.

On close or quit, if the latest draft has not been durably acknowledged, Flashnote must attempt the explicit flush and then follow the product contract's blocking retry / cancel / discard-and-exit choice rather than silently exiting.

The exact debounce duration, retry delay/backoff, revision token representation, and flush timeout are implementation-tuning details to be established and tested with the first persistence vertical slice.

## 11. Native release distribution and update strategy

### Decision

For the first macOS MVP release, distribute Flashnote **directly outside the Mac App Store** as a manually downloaded **DMG containing a production Wails `.app` bundle**.

The initial macOS release contract is deliberately layered:

1. The canonical build unit is a Wails production `.app` bundle generated from repository-owned build assets.
2. The primary user-facing download is a DMG containing that `.app`; a PKG installer is not part of the MVP because Flashnote needs no privileged installer or background-service installation semantics.
3. Production distribution requires a real **Developer ID Application** signature, hardened runtime, secure timestamp, and successful Apple notarization. An ad-hoc signature may be used only as non-credentialed package-structure evidence and must never be reported as production signing.
4. The notarization owner must submit the real release payload to Apple's notary service, require an accepted result, staple the returned ticket where applicable, and perform a Gatekeeper-oriented validation before macOS distribution is declared ready.
5. The first MVP update flow is **manual download of a newer release**. Do not add an in-app updater until a later product need justifies the additional network, release-channel, authenticity, lifecycle, and failure-state surface.

`build/config.yml` is the repository source of truth for release-facing application metadata that Wails projects into platform build assets, including the product name, product identifier, and application version. Release tags or publication metadata must agree with that version rather than introducing a competing version authority.

### Distribution boundary

- The Mac App Store is not part of the initial release path.
- DMG is the primary human-facing distribution envelope. ZIP may be introduced later as a machine/update transport only if an adopted updater or release host requires it; it is not the initial installer surface.
- Windows packaging and signing remain a separate release frontier. The macOS decision must not be described as cross-platform release closure.
- CPU architecture coverage (`arm64`, `amd64`, or universal) is a separate release-acceptance criterion. This decision does not claim architecture coverage before direct package evidence exists.

### Acceptance ownership

Keep release evidence split by failure mode rather than enlarging normal native runtime acceptance:

- **Normal application/runtime correctness** remains owned by the existing native scaffold acceptance.
- **Non-credentialed macOS package acceptance** owns deterministic production `.app` generation and bundle structure/metadata: executable placement, `Info.plist` product identifier/name/version, required resources, and artifact integrity. Any Wails-generated ad-hoc signature is evidence only that the bundle has the expected local package shape.
- **Credentialed macOS distribution acceptance** owns Developer ID identity, hardened-runtime and timestamp requirements, actual Apple notarization, ticket stapling/validation, and Gatekeeper acceptance of the release payload.
- **Updater acceptance does not exist until an updater is actually adopted.** Do not create updater infrastructure or a fake updater proof in advance.

A missing signing certificate or notarization credential leaves the credentialed criterion **UNKNOWN / UNVERIFIED**, not GREEN and not equivalent to a package-build failure.

### Rationale

- Current Wails v3 provides first-party macOS `.app` packaging, DMG construction, Developer ID signing, and notarization tasks, so Flashnote does not need a separate packaging framework merely to ship the MVP.
- A DMG matches a conventional drag-to-Applications desktop distribution without introducing PKG installer semantics that Flashnote does not need.
- Apple direct distribution requires Developer ID signing and notarization for a normal trusted Gatekeeper path; ad-hoc signing is therefore insufficient as release evidence.
- Wails v3 also provides an updater, but availability is not a product requirement. Deferring it keeps the initial release channel manual and prevents speculative update state, network behavior, release-asset rules, and signing interactions from entering the MVP.
- Separating deterministic package proof from credentialed Apple-service proof lets public CI verify everything it can without converting absent secrets into false readiness.

### Boundary

The currently pinned Wails v3 version is sufficient to begin the first package proof; a Wails dependency upgrade is a separate change and should not be coupled to packaging merely because a newer prerelease exists.

This strategy decision does **not** close production macOS release readiness. Deterministic `.app` packaging, final distribution packaging, real Developer ID signing, notarization, Gatekeeper validation, release publication, and supported-architecture coverage each require their own direct evidence before they can be closed.

## 12. Open technical decisions

The following are intentionally not yet fixed:

- exact Go toolchain and version policy
- exact Wails v3 prerelease/stable pin and upgrade policy
- exact Node/pnpm/TypeScript toolchain versions
- backup cadence, retention, and attachment-backup policy
- exact autosave debounce/retry timings and revision-token representation
- attachment ingest/storage implementation details
- search indexing/tokenization implementation
- test stack

These should be grilled only when the decision is materially expensive to reverse or is needed to implement the next vertical slice.
