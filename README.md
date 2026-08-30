# Flashnote

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

The functional MVP is closed. The current path is personal use directly from the source checkout: observe one concrete defect or friction, apply the smallest fix, verify it, and return to use. DMG/installer/signing/notarization work is not part of the active personal-use loop.

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
