# Flashnote Technical Baseline

_Status: evolving implementation baseline · 2026-08-30_

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

### Localization ownership

Flashnote uses one typed frontend message catalog for Korean and English. The persisted language preference is `system`, `ko`, or `en` in the existing settings record; missing or invalid values resolve to `system`. `App.svelte` owns the resolved locale, passes it reactively to presentation components, and updates `document.documentElement.lang` when the setting changes. System resolution uses the WebView navigator language with BCP 47 prefix handling and English fallback.

The catalog is resolved by direct lookup and does not participate in typing, autosave, or per-keystroke document work. Native export dialog copy is passed from the same catalog so translated UI does not acquire a second locale owner.

The durable note summary projection carries a language-independent generated-empty-title discriminator. It is derived from canonical title/body inputs and used only at presentation time; canonical note titles, documents, folder names, and export serialization are never rewritten by locale changes.

### Application shell scroll ownership

The shell is the application's only scroll surface, and each region has exactly one scroll owner. The document pane (`section.document`) owns document scrolling; the sidebar's note list (`nav.note-list`) owns sidebar scrolling; the viewport itself never scrolls. The shell is one viewport-height grid row (`minmax(0, 100%)`) with `overflow: hidden` on the shell, the sidebar, and the page root, so neither a long document nor a long note list can push the layout taller than the viewport and hand scrolling back to the page. This is what keeps a single vertical scrollbar visible per region instead of a duplicate at the page level.

`overflow: hidden` is not treated as the proof: a programmatically scrolled or mis-sized ancestor still shows scroll range. The contract is proven by real scrolling — the page must not move, the pane and the note list must each independently reach their full scroll range, and the editor's nearest scrollable ancestor must be the document pane, which is what makes caret following, wheel, and keyboard scrolling resolve to one container. Scrollbar presentation stays on the platform scrollbar component: the app's scroll surfaces use the standard `scrollbar-width: thin` and `scrollbar-color: <token> transparent` declarations with theme-aware thumb tokens, and no custom scrollbar component or `::-webkit-scrollbar` pseudo-element styling is introduced. `scrollbar-width: none` is not used, because hiding a scrollbar removes the visible scroll affordance that the one-scrollbar-per-region contract gives the user.

## 3. Rich-text editor

### Decision

Use **Tiptap 3** as the rich-text editor layer, backed by ProseMirror.

### Rationale

- Flashnote needs structured rich text, not Markdown-first live storage.
- Tiptap provides a practical extension layer over ProseMirror without requiring the application to own the full editor framework itself.
- The required MVP vocabulary—paragraphs, headings, lists, task items, quotes, code blocks, dividers, links, images, and inline formatting—fits Tiptap's extension model.
- Paste normalization, image-node behavior, slash-command behavior, and constrained document schema can be implemented while retaining access to lower-level ProseMirror APIs when necessary.
- Svelte integration is supported without making React a dependency of the application UI.

The table construct uses Tiptap's table extension (`@tiptap/extension-table`) rather than a hand-built ProseMirror table schema, because merge, column-width, and keyboard cell movement are already solved there and re-implementing them would create a competing owner of table semantics. Flashnote still owns which of those attributes are valid canonical data (§4).

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

### Schema version 2

`schemaVersion` was extended from `1` to `2` to add two constructs: an ordinary in-note table, and an in-note task database (`docs/PRODUCT.md` §5.6).

- v1 documents remain readable. A v1 document is never destructively rewritten merely because it was opened.
- The frontend may promote a v1 document to v2 when it saves, because v2 admits the whole v1 vocabulary unchanged. Promotion is a single version-bump on an otherwise identical body, so existing text, image, list, and checklist meaning is preserved by construction.
- A document claiming a version above the supported one fails validation visibly. Flashnote does not silently downgrade an unknown future version, because that would lose data it cannot interpret.
- Every new node type and attribute is validated explicitly in Go. Duplicate identifiers, wrong types, dangling row/property references, and circular date rules are rejected rather than normalized away.
- An invalid document is rejected with a specific error; Flashnote never replaces a malformed document with an empty note.

Version 2 adds exactly two node types to the vocabulary:

- `table` / `tableRow` / `tableCell` / `tableHeader` — an ordinary document table. Its stored JSON is the same shape the Tiptap table extension emits, so editor load/save needs no translation layer. `tableCell` and `tableHeader` carry `colspan`, `rowspan`, and `colwidth` because that is what makes merge and column-width state round-trip without a second representation.
- `database` — one in-note task database. Its entire payload lives in the node's `attrs`; it has no child nodes.

The `database` payload is the database's single authority and is a plain JSON value, so it inherits the owning note's save, revision, backup, trash, and restore behavior without a second transaction path. Its shape is:

```json
{
  "properties": [{ "id": "…", "name": "Status", "type": "status",
                   "options": [{ "id": "…", "name": "To do", "done": false }] }],
  "records": [{ "id": "…", "values": { "…": "…" }, "memo": "Markdown memo" }],
  "dateRules": [{ "id": "…", "basePropertyId": "…", "targetPropertyId": "…", "offsetDays": 7 }],
  "manualDates": [{ "recordId": "…", "propertyId": "…" }],
  "view": "table",
  "sort": { "propertyId": "…", "direction": "asc" },
  "filters": [{ "propertyId": "…", "op": "is", "value": "…" }],
  "rowHighlights": { "…": "yellow" }
}
```

Supported property types are `title`, `text`, `number`, `date`, `status`, `checkbox`, `select`, and `multiSelect`. Exactly one property is the `title`. Date values are calendar dates in `YYYY-MM-DD` form; they are never millisecond timestamps, so date arithmetic cannot drift across daylight-saving transitions (§10).

Sorting, filtering, highlight, and view settings are stored as presentation state on the node. They are derived from the same records they present, and clearing a filter or changing a sort never alters record data. Conditional highlights (overdue, due soon, complete) are computed at display time and are deliberately not stored, so a stored value can never become stale highlight state.

### Database date rules

A `dateRule` links one date property to another with a calendar-day offset. The invariant Go enforces on save is: for every record not listed in `manualDates` for that rule, the target value equals the base value shifted by `offsetDays` on the calendar, and is `null` when the base value is missing or invalid. Flashnote never invents a target value for an absent base date. Rules may not form a cycle, may not reference non-date properties, and may not reference a base equal to its target.

A manual edit to a rule-driven target adds an entry to `manualDates` for that record and property. This detaches only that record; the rule definition and every other record's link stay intact, and the record does not get overwritten the next time its base date changes. Detachment is stored, not inferred, because inferring it from value comparison would silently re-link a date the user set to exactly the value the rule would have produced.

The editor recomputes rule-driven targets in the same ProseMirror transaction that changes the base date, so the base change and its consequences commit atomically to the document. Go's validation is the independent check that the two sides agree; it computes the same calendar arithmetic in `internal/document` and is covered by its own tests.

### Undo and transaction ownership

Every mutating action listed in the product contract — table cell edits, row and column add/delete, merge and unmerge, table-to-database conversion, database cell edits, detail-panel edits, batch edits, date-rule edits, and calendar task creation — is one ProseMirror transaction on the owning note. A batch edit and a conversion are each one logical Undo unit.

Because the whole `database` payload lives in one node's attrs, a database edit is a `setNodeAttrs` step rather than a text transaction. This keeps a database edit inside the note's normal undo history while leaving the surrounding prose history untouched. The existing behavior that switching notes clears undo history is unchanged; moving between detail panel, calendar, and table inside one note must not break undo or edit the wrong record.

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

When a transition-gating flush fails, one shared save-failure boundary offers stay/retry/discard; individual navigation functions do not own their own failure dialogs. An explicit discard invalidates the abandoned draft's persistence context so already-dispatched save completions cannot mutate a later note's revision, durable sequence, error state, retry scheduling, or sidebar refresh, and the discarded draft never schedules a further automatic retry.

On close or quit, if the latest draft has not been durably acknowledged, Flashnote must attempt the explicit flush and then follow the product contract's blocking retry / cancel / discard-and-exit choice rather than silently exiting.

The exact debounce duration, retry delay/backoff, revision token representation, and flush timeout are implementation-tuning details to be established and tested with the first persistence vertical slice.

## 11. Personal use, private cross-Mac installation, and sync boundary

### Decision

The normal macOS dogfooding path remains **direct personal use from the source checkout**. `./Flashnote.command` is the real-note launcher: it builds the current frontend and starts one stable Go/Wails process without watch/HMR/rebuild relaunch behavior. Acceptance-only Vite flags are cleared before that build so a stale shell environment cannot accidentally turn the personal-use process into a mutation harness.

`frontend/dist` is embedded into the Go binary by `go:embed`, so the binary — not the source tree — is what a running application presents. The Go toolchain stamps the binary with the source revision it was built from (`vcs.revision`); `RuntimeInfo.AppRevision` reads that stamp out of the running binary and the Settings dialog shows it. An unstamped build reports `unknown` rather than a revision it did not capture. Relaunching the dev bundle directly (Dock or Finder) bypasses the rebuilding launcher, so the binary's own stamp is the only reliable statement of which build a user is observing.

`wails3 dev` is a development/debugging tool only. It is not a real-note runtime because source edits may replace the frontend or relaunch the application outside Flashnote's normal transition/close flush path while the frontend still owns an unsaved draft.

### Private cross-Mac installation

For the explicit personal-use case of installing Flashnote on another Mac owned by the same user, build a universal DMG with:

```bash
wails3 task --taskfile ./Taskfile.release.yml package:macos:universal:dmg
```

The DMG contains a universal app for Apple silicon and Intel Macs, with macOS 12 as the minimum. The receiving Mac does not need the Go/Node/Wails development toolchain. The bundle is ad-hoc signed only: it is **not** Developer ID-signed or notarized, so macOS may require a one-time manual Gatekeeper approval. This is a private sideload path, not a public-release guarantee.

### Data-safety and sync boundary

Native/UI/acceptance/destructive automation must never use the normal Flashnote data directory. On macOS, the default isolation mechanism is a fresh temporary `HOME`, so the test database lives at `<temporary HOME>/Library/Application Support/Flashnote/flashnote.db`.

A real-use process may use the normal user data directory. An automated mutating process may not.

Each Mac currently has an independent local library under `~/Library/Application Support/Flashnote`; installing the app does not transfer notes. A request to use the same library across personal Macs has reopened sync as a design frontier, but Flashnote does not yet implement sync. Do not treat a generic cloud-drive sync of the live data directory as a safe substitute: SQLite's database/WAL state and image attachments must move consistently, and concurrent writes require explicit conflict handling. Any supported handoff or sync must be application-mediated and preserve the SQLite Online Backup boundary.

### Distribution boundary

The private universal DMG described above is the only active distribution scope. Public release publication, PKG installers, Developer ID signing, notarization, updater work, and general external distribution remain **DEFERRED / INACTIVE**. Existing package/DMG acceptance workflows remain manual-only and must not run on ordinary `main` pushes while public distribution is inactive.

If public distribution is explicitly reopened later, re-admit the signing/notarization design against then-current Wails and Apple requirements rather than treating this private ad-hoc package as release-ready.

### Rationale

- Flashnote's frontend deliberately owns the latest unsaved editor draft until Go acknowledges a durable save.
- Normal note navigation and window close have explicit flush guards, but a development watcher can reload/relaunch outside those controlled lifecycle paths.
- A stable source-run process remains the simplest dogfooding workflow; a self-built universal DMG removes source/toolchain setup from a personally owned secondary Mac without implying a public release.
- Sync is a separate persistence/distribution concern: packaging the executable cannot make the local library follow the user safely.

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
