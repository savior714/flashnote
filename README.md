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

The functional MVP and the accepted Apple Silicon packaging baseline are closed. Current development is driven by real personal use: observe one concrete defect or friction, apply the smallest fix, verify it, and return to use.

## Development

Prerequisites:

- Go 1.27+
- Node.js 24+
- Corepack / pnpm 11

On macOS, clone the repository and launch the development app with:

```bash
git clone https://github.com/savior714/flashnote.git
cd flashnote
./Flashnote.command
```

`Flashnote.command` can also be double-clicked in Finder. It verifies the required host tools, installs the Wails CLI version pinned by this repository when necessary, and starts `wails3 dev`. The existing Wails dev configuration performs the one-time frontend dependency install and then manages the frontend dev server plus Go rebuild/relaunch cycle.

Manual equivalent:

```bash
go install github.com/wailsapp/wails/v3/cmd/wails3@v3.0.0-beta.11
wails3 dev -config ./build/config.yml
```

Useful checks:

```bash
wails3 task check
```

Generated dependency lockfiles (`go.sum` and `frontend/pnpm-lock.yaml`) should be committed after intentional dependency resolution on a network-enabled development machine.
