# Flashnote

English · [한국어](README.md)

A lightweight, beautiful, local-first document note app for macOS and Windows.

Flashnote keeps the polished writing feel of a modern document editor while deliberately avoiding workspace, database-view, collaboration, PKM, cloud, and plugin complexity.

## Product and technical authority

- [`docs/PRODUCT.md`](docs/PRODUCT.md) defines the product contract.
- [`docs/TECHNICAL.md`](docs/TECHNICAL.md) records implementation-level baseline decisions.
- [`docs/DEVELOPMENT.md`](docs/DEVELOPMENT.md) defines development/publication rules and the current post-MVP dogfood loop.
- [`docs/DISTRIBUTION.md`](docs/DISTRIBUTION.md) defines how install files are built, published, and (later) signed.

## Install

Install files are published on [Releases](https://github.com/savior714/flashnote/releases). Installing does not require Go, Node.js, or a source checkout.

### macOS (macOS 12 or later · Apple silicon / Intel)

1. Download `Flashnote-<version>-macOS-universal.dmg` from the latest release and open it.
2. Drag `Flashnote.app` into **Applications**.
3. If macOS blocks the first launch, Control-click the app and choose **Open**, or use **System Settings → Privacy & Security → Open Anyway**.
   From a terminal: `xattr -dr com.apple.quarantine /Applications/Flashnote.app`

### Windows (Windows 10 or later · x64 / ARM64)

1. Download `Flashnote-<version>-windows-setup.exe` from the latest release and run it.
2. If SmartScreen says "Windows protected your PC", choose **More info → Run anyway**.
3. One installer covers x64 and ARM64 and installs per user, without administrator rights.

`Flashnote-<version>-windows-portable.zip` runs without installing.

> These builds are not yet Developer ID-signed/notarized on macOS and not code-signed on Windows, so step 3 (or step 2) is needed once. [`docs/DISTRIBUTION.md`](docs/DISTRIBUTION.md) covers adding signing.

## Current implementation baseline

- Wails v3 + Go backend
- Svelte 5 + TypeScript frontend
- Tiptap 3 over ProseMirror
- SQLite through `modernc.org/sqlite`
- Go-owned persistence boundary

The functional MVP is closed. The normal dogfooding path remains personal use directly from the source checkout: observe one concrete defect or friction, apply the smallest fix, verify it, and return to use.

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

## Build the install files yourself

The receiving computer needs no toolchain. [`docs/DISTRIBUTION.md`](docs/DISTRIBUTION.md) has the full runbook.

macOS universal DMG:

```bash
wails3 task --taskfile ./Taskfile.release.yml package:macos:universal:dmg
```

Windows executables and NSIS installer (Git Bash, or macOS/Linux with NSIS installed):

```bash
VERSION=0.1.0 bash ./scripts/package-windows-release.sh
```

Outputs are `bin/flashnote.dmg`, `bin/flashnote-amd64.exe`, `bin/flashnote-arm64.exe`, and `bin/Flashnote-0.1.0-windows-setup.exe`.

Pushing a `v*` tag builds all of these in CI and publishes them as a GitHub Release; see [`.github/workflows/release-installers.yml`](.github/workflows/release-installers.yml).

## Where notes live

```
macOS    ~/Library/Application Support/Flashnote/
Windows  %APPDATA%\Flashnote\
```

Each directory holds `flashnote.db` (notes, folders, trash), `attachments/`, and `backups/`. Installing the app does not transfer or sync notes: each computer keeps its own library, and Flashnote has no cross-device sync yet. Do not put the live data folder in iCloud Drive, Dropbox, OneDrive, or another generic file-sync folder: SQLite's database/WAL files and image attachments must remain consistent, and simultaneous edits need conflict handling.
