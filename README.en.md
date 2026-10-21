# Flashnote

English · [한국어](README.md)

A lightweight, beautiful, local-first document note app for macOS and Windows.

Flashnote keeps the polished writing feel of a modern document editor while deliberately avoiding workspace, database-view, collaboration, PKM, cloud, and plugin complexity.

## Product and technical authority

- [`docs/PRODUCT.md`](docs/PRODUCT.md) defines the product contract.
- [`docs/TECHNICAL.md`](docs/TECHNICAL.md) records implementation-level baseline decisions.
- [`docs/DEVELOPMENT.md`](docs/DEVELOPMENT.md) defines development/publication rules and the current post-MVP dogfood loop.

## Current implementation baseline

- Wails v3 + Go backend
- Svelte 5 + TypeScript frontend
- Tiptap 3 over ProseMirror
- SQLite through `modernc.org/sqlite`
- Go-owned persistence boundary

The functional MVP is closed. The normal dogfooding path remains personal use directly from the source checkout: observe one concrete defect or friction, apply the smallest fix, verify it, and return to use. A separate private universal DMG path is available for installing on another Mac you own; this is not a public, Developer ID-signed release.

## Personal use from source

Prerequisites:

- Go 1.27+
- Node.js 24+
- Corepack / pnpm 11

On macOS, clone the repository and run:

```bash
git clone https://github.com/savior714/flashnote.git
cd flashnote
./Flashnote.command
```

`Flashnote.command` can also be double-clicked in Finder. It verifies the host tools, installs the Wails CLI version pinned by this repository when necessary, clears Flashnote acceptance-only Vite flags, builds the current frontend, and starts one stable Go/Wails process against the normal Flashnote data directory.

The personal-use launcher intentionally does **not** start `wails3 dev`. Watch/HMR/rebuild relaunches are useful while coding, but they can replace the frontend or process outside Flashnote's normal save/close transition and therefore are not an acceptable lifecycle boundary for real notes.

## Install on another Mac you own (private DMG)

Build the app on the development Mac, then transfer the DMG to the other Mac. The receiving Mac does **not** need Go, Node.js, Corepack, Wails, or a source checkout.

On the development Mac, with this repository's normal prerequisites installed, run:

```bash
wails3 task --taskfile ./Taskfile.release.yml package:macos:universal:dmg
```

The output is `bin/flashnote.dmg`. It contains a universal app for Apple silicon and Intel Macs and supports macOS 12 or later. Open the DMG on the other Mac, drag `Flashnote.app` to `Applications`, then launch it.

This private build is ad-hoc signed but **not Developer ID-signed or notarized**. macOS may block its first launch. Since this is your own build, use Finder's Control-click → **Open**, or **System Settings → Privacy & Security → Open Anyway** if macOS offers that option. Do not disable Gatekeeper globally or approve a build you do not trust.

Installing the app does not transfer or sync its notes. Each Mac currently has its own library under `~/Library/Application Support/Flashnote`; Flashnote has no cross-Mac sync yet. Do not put the live database folder in iCloud Drive, Dropbox, or another generic file-sync folder: SQLite's database/WAL files and image attachments must remain consistent, and simultaneous edits need conflict handling. A safe sync or handoff workflow needs to be designed separately.

## Development watch mode

Use watch mode only while actively changing/debugging code, not as the real-note launcher:

```bash
go install github.com/wailsapp/wails/v3/cmd/wails3@v3.0.0-beta.11
wails3 dev -config ./build/config.yml
```

Native/UI/acceptance automation must use an isolated temporary `HOME`; it must never point at the normal Flashnote database or user-data directory.

Useful checks:

```bash
wails3 task check
```

Generated dependency lockfiles (`go.sum` and `frontend/pnpm-lock.yaml`) should be committed after intentional dependency resolution on a network-enabled development machine.
