# Flashnote

A lightweight, beautiful, local-first document note app for macOS and Windows.

Flashnote keeps the polished writing feel of a modern document editor while deliberately avoiding workspace, database-view, collaboration, PKM, cloud, and plugin complexity.

## Product and technical authority

- [`docs/PRODUCT.md`](docs/PRODUCT.md) defines the current MVP product contract.
- [`docs/TECHNICAL.md`](docs/TECHNICAL.md) records implementation-level baseline decisions.

## Current implementation baseline

- Wails v3 + Go backend
- Svelte 5 + TypeScript frontend
- Tiptap 3 over ProseMirror
- SQLite through `modernc.org/sqlite`
- Go-owned persistence boundary

The initial scaffold proves the desktop shell, editor mounting point, application-private SQLite creation, embedded schema migration, and runtime database-policy verification. Product workflows are not feature-complete yet.

## Development

Prerequisites:

- Go 1.27+
- Node.js 24+
- Corepack / pnpm 11
- Wails v3 CLI pinned to the version used by `go.mod`

Install the Wails CLI:

```bash
go install github.com/wailsapp/wails/v3/cmd/wails3@v3.0.0-beta.11
```

Install frontend dependencies and normalize Go module metadata:

```bash
corepack enable
cd frontend
corepack pnpm install
cd ..
go mod tidy
```

Then run:

```bash
wails3 dev
```

Useful checks:

```bash
task check
```

Generated dependency lockfiles (`go.sum` and `frontend/pnpm-lock.yaml`) should be committed after dependency resolution on a network-enabled development machine.
