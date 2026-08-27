# Flashnote Product Contract

_Status: product baseline v0.1 · 2026-08-27_

This document is the current product authority for Flashnote's agreed MVP direction. It records product behavior and durable constraints, not transient implementation details. When implementation choices change without changing the product contract, update lower-level technical documentation instead of expanding this document.

## 1. Product definition

Flashnote is a very lightweight, beautiful, local-first document note app for macOS and Windows.

The product keeps the polished writing feel of modern block-style document editors while deliberately removing workspace, database, collaboration, PKM, cloud, and plugin complexity.

Primary use case: writing short personal documents such as ideas, meeting notes, study notes, and a few-paragraph-to-few-page documents.

"Short" is a product focus, not a hard document-length limit. Long documents remain editable, but Flashnote does not add long-document management features merely to support them.

### Core product loop

1. Find or create a document.
2. Write.
3. Autosave invisibly.
4. Close the app.
5. Search and reopen later.

The quality of startup latency, typing latency, autosave reliability, search latency, and typography matters more than feature count.

## 2. Explicit non-goals for the MVP

Flashnote does **not** include:

- accounts or authentication
- cloud storage or sync
- collaboration
- database-style pages or structured-data views
- tags, backlinks, note graph, or PKM workflows
- internal note links or `[[...]]` syntax
- plugins
- AI features
- templates
- nested folders
- a block database
- block drag handles or block reordering UI
- document tabs, split view, or multiple document windows
- pinned documents
- command palette
- customizable keyboard shortcuts
- table editing
- PDF/HTML/CSV export
- Markdown import/re-import
- quick-capture tray/menu-bar workflows
- sticky notes, reminders, calendar integration, or mobile capture
- document outline, table of contents pane, chapters, pagination, or document statistics

Future features should not be pre-built speculatively. They should be added only when the product need is demonstrated.

## 3. Window and navigation model

### 3.1 Two-pane layout

The normal UI contains only:

- a compact sidebar for navigation
- one editor for the currently selected document

Only one document is open at a time. Selecting another note replaces the editor contents immediately.

The sidebar is visible by default but can be toggled. Hiding it is only a visibility change; there is no separate "focus mode" product state. When hidden, the editor receives the available window space while retaining its own readable maximum content width.

### 3.2 Startup

On launch:

- reopen the last viewed document when it still exists
- otherwise open a new empty document
- do not show a home screen, recent-files dashboard, workspace chooser, onboarding flow, or sample document

The product should be understandable without onboarding. A subtle editor placeholder such as `Type / for commands` is acceptable and disappears once the user starts writing.

## 4. Sidebar information architecture

### 4.1 Folder model

Folders are intentionally shallow:

- notes may live at root
- folders may live at root
- notes may live inside a folder
- folders cannot contain folders
- a note belongs to at most one folder

No virtual `Notes`, `Inbox`, or `Unfiled` container is created. Root notes appear directly at the top of the sidebar.

### 4.2 Ordering

- root notes: most recently modified first
- folders: alphabetical by name
- notes inside each folder: most recently modified first

There is no user-defined manual ordering and no sort selector in the MVP.

### 4.3 Sidebar density

Sidebar note rows show the note title only. Do not show body previews, dates, word counts, badges, or similar metadata by default.

Folders show their name and a disclosure affordance. Controls should remain visually quiet and appear mainly on hover/focus where appropriate.

### 4.4 Creating notes and folders

Creation uses one quiet `+` control at the top of the sidebar. Activating it offers exactly the creation choices needed for the MVP:

- `New note`
- `New folder`

Choosing `New folder` starts inline naming in the sidebar rather than opening a separate creation dialog. New folders are root-level by definition.

A new note is created at the user's current location:

- while working at root, create it at root
- while viewing a note inside a folder, create it in that folder

Do not interrupt note creation with a location picker.

### 4.5 Moving notes

Notes can move between root and 1-depth folders in two ways:

- sidebar drag and drop
- a quiet Move control revealed on note-row hover/focus

The Move control sits immediately to the left of the row's Trash control. It is enabled only when at least one alternate destination exists, and its menu shows only valid destinations: `Root` when the note is currently inside a folder, plus every 1-depth folder other than the note's current folder.

Drag and drop means **folder membership change only**. It never means manual ordering.

Do not expose note or folder operations through a right-click context menu in the MVP.

### 4.6 Trash navigation

Trash is a fixed destination at the bottom of the sidebar, visually separated from normal root notes and folders. It should remain easy to find for recovery without being presented as a normal folder or promoted with item-count badges or similar attention-seeking metadata.

Entering Trash is reversible navigation. The Trash view must always expose an explicit path back to the normal library without requiring any restore, deletion, or other data mutation. Leaving Trash should return to the previously viewed normal note or folder when it still exists; otherwise fall back to the nearest sensible surviving normal location.

## 5. Editor behavior

Flashnote should feel block-like to write in without implementing a Notion-style block database.

### 5.1 Document structure

A note is one rich-text document. The editor may visually present paragraph-like blocks, but individual blocks do not need independent database identity.

Supported MVP content types:

- paragraph
- heading 1
- heading 2
- heading 3
- bullet list
- numbered list
- todo/checklist
- quote
- code block
- divider
- image

Supported inline formatting:

- bold
- italic
- strikethrough
- inline code
- external URL link

Todo/checklist completion is deliberately document-local: checking or unchecking changes only that item's checked state and visual treatment. Completed items stay in place. Do not automatically reorder or hide them, add completion timestamps, task filters, reminders, or a task database.

Not supported in the MVP:

- tables
- embeds
- arbitrary block types
- internal note links
- block handles
- block drag/reorder
- persistent formatting toolbar

### 5.2 Formatting UI

Keep editor chrome minimal:

- no always-visible formatting toolbar
- text selection may show a small contextual formatting bubble
- typing `/` on an appropriate empty line opens a compact slash-command menu
- common Markdown-style input shortcuts may convert text into supported structures

The slash menu should expose only supported content types rather than becoming a general command palette.

### 5.3 Title behavior

Title and body remain logically distinct.

- a new note focuses the title position immediately
- pressing Enter from the title proceeds naturally into the body
- title is single-line and has no rich formatting
- an empty explicit title is allowed
- do not persist the literal string `Untitled` merely to fill an empty title
- when title is empty, derive a display title from the first meaningful body text
- the derived display title is presentation/search data, not a second canonical stored title

### 5.4 Links

Only external URL links are supported in the MVP.

- recognize ordinary URLs
- allow a selected text range to receive a URL link
- open external links in the user's default browser

Do not implement note autocomplete, internal links, backlinks, broken-link management, or graph semantics.

## 6. Paste and image handling

### 6.1 Rich paste policy

Pasted content is normalized into Flashnote's supported rich-text vocabulary.

Preserve when representable:

- bold / italic / strikethrough
- headings
- bullet / numbered lists
- links
- supported paragraph/quote/code structures
- supported images

Strip or simplify:

- source font families and font sizes
- text/background colors
- arbitrary CSS and HTML attributes
- unsupported embeds or widgets
- source-editor-specific metadata
- unsupported block types
- tables

The resulting document must always fit the canonical Flashnote rich-text schema.

Pasted tables should degrade to a reasonable supported textual representation rather than introducing table nodes.

### 6.2 Images

MVP image insertion is deliberately narrow:

- paste an image or screenshot from the clipboard
- drag and drop an image file into the editor
- display the image inline as a document block
- allow deletion
- allow simple resizing

Do not add a general attachment system, gallery, caption editor, annotation, crop UI, arbitrary file attachments, remote-image embeds, or attachment manager.

Image ingest should follow one canonical application path regardless of paste vs drag/drop.

For normal supported images, preserve the ingested source representation and quality when available; do not routinely downscale or recompress images merely to save space. Exceptionally large or pathological inputs may cross implementation-defined safety limits; at that boundary Flashnote may downscale or re-encode them, or reject insertion with a clear error, to protect application responsiveness and local storage. Exact byte, dimension, format, and codec thresholds are implementation details and are not exposed as normal user settings.

## 7. Search

`Cmd/Ctrl + K` opens a focused search overlay.

When the overlay opens with an empty query, show a compact list of recently modified notes. This is a quick-reentry state inside search, not a separate Recent view or saved-search history. Typing any query immediately replaces the recent list with normal search results.

Notes in Trash are excluded from both the empty-query recent list and normal search results. Recovery discovery happens inside Trash; the main search overlay does not expose an `Include Trash` filter in the MVP.

Search scope:

- explicit note title
- derived display title
- note body text

Ranking should favor title matches over body matches, then favor more recently modified documents when otherwise comparable.

Results may show a short matching body excerpt. The sidebar itself remains title-only.

Keyboard behavior:

- type to update results immediately
- arrow keys move through recent notes or search results
- Enter opens the selected note
- Escape closes search

Do not add advanced operators, saved searches, filters, folder-scoped search, AI search, or command execution to this UI in the MVP.

## 8. Deletion and Trash

Deletion is soft by default.

In the normal sidebar, hovering or focusing a note row reveals two quiet controls at the right edge: Move on the left and Trash at the far right. Folder rows reveal only the Trash control because folders are root-only in the MVP. Activating Trash enters the ordinary soft-delete flow below. Deletion must not depend on a context menu.

### 8.1 Notes

Deleting a note moves it to Trash. Activating a note's Trash action must show a lightweight confirmation before the move occurs, even though the action is recoverable. The confirmation should make clear that the note is moving to Trash rather than being permanently deleted. Keep the lightweight Undo affordance after deletion.

When the note being deleted is the one currently open, immediately move the editor to a nearby surviving note rather than leaving a deleted or dead-end editor state. Prefer a nearby note in the same folder when one exists; otherwise open the nearest sensible surviving note in the library. Only create a new empty note when no normal notes remain.

Permanent deletion happens only from Trash and requires explicit destructive confirmation.

There is no automatic Trash expiry in the MVP.

### 8.2 Folders

Deleting a folder moves the folder **and all notes currently inside it** to Trash.

If a folder contains at least one note, deletion must show a strong confirmation that states the actual consequence, for example:

> This folder and 7 notes will be moved to Trash.

The UI must not hide the multi-document consequence behind wording that sounds like only the empty container is being removed.

Empty-folder deletion may use lighter friction.

### 8.3 Trash recovery unit

When a folder and its notes are deleted together, preserve them as one recovery unit.

- Trash keeps the deleted folder-note relationship visible
- restoring the folder restores the notes deleted with that folder into the same folder structure
- individual restoration of a child note from a deleted-folder recovery unit is not part of the MVP
- Trash content can be opened read-only for inspection/copying
- editing requires restoration first
- do not flatten deleted folder contents into an unrelated list

### 8.4 Empty Trash

Trash provides an `Empty Trash…` action inside the Trash view only. It permanently deletes all Trash contents in one operation and must require a strong destructive confirmation that states how many notes/folders will be deleted and that the action cannot be undone.

Keep individual permanent deletion as well. Do not add multi-select or bulk-selection UI merely to support partial batch deletion in the MVP.

## 9. Persistence and data authority

### 9.1 Canonical data

SQLite is the single internal source of truth for document structure and metadata.

Rich-text document data is canonical. Plain text used for search, derived display titles, indexes, and similar values are derived data and must not become competing authorities.

Markdown files are export artifacts, not the live storage authority.

### 9.2 Identity

Use stable path-independent identities for notes, folders, and attachments.

Filesystem paths and filenames must not define object identity.

This is enough to avoid needlessly blocking a possible future sync feature, but the MVP must **not** implement sync-ready infrastructure such as device state, revision logs, conflict metadata, CRDT/OT, or synchronization queues.

Schema migration and data format evolution should remain possible.

### 9.3 Autosave

Saving should normally be invisible to the user. There is no Save button and no persistent `Saved` indicator in normal operation.

Implementation may debounce ordinary typing writes and flush at important transitions, but exact timings are implementation details rather than product contract.

A save failure must remain visibly present until it is resolved rather than disappearing as a transient toast. Show a compact non-modal failure state near the editor, automatically retry saving in the background, and allow the user to continue editing while retry is appropriate. Once persistence recovers and the pending changes are durably saved, remove the failure state without introducing a persistent success indicator.

If the user requests window/app close while unsaved changes remain because persistence has not succeeded, do not close silently. Present a blocking choice to retry saving, cancel the close, or explicitly discard the unsaved changes and exit. Discard-and-exit is destructive and must be clearly labeled as such. This prompt is exceptional failure handling, not a normal save confirmation shown during ordinary successful autosave.

### 9.4 Images and attachment authority

Do not store image binaries as SQLite BLOBs by default.

- SQLite stores attachment identity and metadata/reference
- image bytes live in an application-private local attachments directory
- rich-text content refers to an attachment ID, not an arbitrary absolute filesystem path
- the database defines which attachments should exist; attachment filenames/directories carry no domain meaning

External files dragged into the app are ingested into application storage rather than remaining fragile references to arbitrary user paths.

## 10. Backup

Provide an invisible rolling local backup safety net.

- backups are for disaster recovery, not user-facing document revision history
- use a transactionally consistent SQLite backup mechanism rather than blindly copying a live database file
- maintain a small bounded rolling set
- take an additional safety snapshot before schema migration where appropriate
- do not expose backup cadence, retention count, or low-level mechanics as normal MVP settings

Attachment backup/retention may be handled separately from frequent small database snapshots so large image libraries do not multiply the database backup footprint unnecessarily.

Exact retention policy remains an implementation decision until operational evidence requires a product setting.

## 11. Export and data portability

MVP supports:

1. export one note as Markdown
2. export the full library as Markdown

Full-library export should preserve the user-visible 1-depth folder organization as directories where practical and export image attachments alongside the Markdown using relative references.

Export is one-way:

`SQLite + app-local attachments -> Markdown + image files`

Markdown import/re-import is not part of the MVP.

Do not add PDF, HTML, CSV, or extensive export customization in the MVP.

Cross-platform filename sanitization/collision handling is an export concern and must not leak back into the canonical note identity model.

## 12. Visual design

### 12.1 Character

Use a warm, quiet minimal visual language inspired by the calm writing surface of Notion rather than its workspace complexity.

- warm off-white / neutral surfaces in light mode
- charcoal rather than harsh pure-black text where appropriate
- minimal borders
- restrained shadows
- restrained corner rounding
- typography and spacing provide hierarchy
- accent color appears mainly for focus, selection, and actionable state
- sidebar is visually quieter than the document
- macOS and Windows should feel like the same product without over-imitating either OS

### 12.2 Density

Use medium information density.

- editor has comfortable line height and whitespace
- sidebar is somewhat more compact than the editor
- avoid both sparse showcase-layout spacing and IDE-like density

### 12.3 Editor width

The document is centered with a readable maximum width.

- wide windows add surrounding whitespace rather than stretching lines indefinitely
- narrow windows reduce the document width responsively
- hiding the sidebar does not turn the document into a full-width page
- no per-document `Wide` or `Full width` toggle in the MVP

### 12.4 Typography

Use the platform system sans-serif for UI and normal document text, with system monospace for inline/code blocks.

Do not bundle a custom font merely to force macOS and Windows to render identically. Do not add per-document font families, serif mode, or typography themes in the MVP.

## 13. Appearance and settings

Appearance modes:

- System
- Light
- Dark

Do not add user-authored themes, custom backgrounds, font themes, or accent customization in the MVP.

The settings surface should stay intentionally small:

### Appearance

- System / Light / Dark

### Editor

- font size
- spellcheck

### Data

- export all

Do not expose sidebar width, editor width, line height, autosave interval, backup retention, attachment directory, advanced/debug settings, or similar implementation details unless a real product need emerges.

## 14. Keyboard baseline

Keep a small, conventional shortcut surface:

- `Cmd/Ctrl + N` — new note
- `Cmd/Ctrl + K` — search
- `Cmd/Ctrl + \\` — toggle sidebar
- `Cmd/Ctrl + ,` — settings
- conventional editor shortcuts for bold/italic/undo/redo and normal platform text editing

Do not assign dedicated shortcuts to every note operation and do not add shortcut customization or a command palette in the MVP.

## 15. Future sync boundary

The MVP is fully local-only:

- no account
- no cloud backend
- no sync engine
- no conflict resolution
- no device model
- no synchronization worker

Future optional sync is not ruled out. The only deliberate low-cost preparation is stable object identity plus sane schema/data-version evolution. If sync becomes a real product requirement, design it then as a separate product and architecture problem rather than pre-building it now.

## 16. Current open decisions

The following areas are intentionally not yet product-contract decisions and should be resolved only when they become the next useful design frontier:

- exact autosave debounce and lifecycle flush mechanics
- exact rolling-backup cadence/retention
- precise search tokenizer/ranking implementation
- exact image safety thresholds and normalization mechanics
- Markdown filename collision/sanitization details
- exact editor implementation library/framework and version pins
- accessibility acceptance details beyond normal platform semantics and adequate contrast/focus behavior

When one of these is resolved, add only the durable product consequence here; keep low-level implementation detail in technical documentation.
