# Flashnote testing

## Canonical rule

Flashnote uses **headless by default, native by exception**.

Most user-flow acceptance must not open the macOS application window. The default end-to-end path is the real Svelte frontend talking to the real Go services and isolated SQLite storage through Wails v3 server mode, driven by headless Playwright.

## Test lanes

| Lane | Use it for | Runtime |
| --- | --- | --- |
| Go tests | persistence, migrations, service/domain invariants, data safety | `go test ./...` |
| Headless E2E | UI + generated Wails binding + Go service + SQLite user flows | `task e2e:headless` |
| Native smoke | behavior that intrinsically depends on macOS/WKWebView/native APIs | isolated native acceptance only |

Native smoke is reserved for application launch, WKWebView/native bridge admission, native dialogs, macOS menu or shortcut integration, close/window lifecycle, and defects shown to be WKWebView-specific. Normal note, folder, search, Trash, save, and navigation workflows should move to headless E2E when browser automation can observe the required invariant.

## Data safety

Every state-mutating Flashnote E2E process must use isolated storage. `scripts/run-headless-e2e.sh` launches the Wails server with a fresh temporary `HOME`; it never points at the normal Flashnote database. The temporary home is removed after the run.

Do not weaken this by introducing an acceptance mode that reuses the user's normal `HOME` or `flashnote.db`.

## Headless runtime

The repository currently pins Wails `v3.0.0-beta.11`, which already supports server mode via the `server` build tag and `WAILS_SERVER_HOST` / `WAILS_SERVER_PORT`. The headless runner therefore uses the existing Wails version rather than coupling this testing change to a Wails upgrade.

The first representative Playwright flow creates a folder through the real Go binding, verifies disclosure collapse/expand in the DOM, reloads the page, and proves that the folder was persisted through the isolated SQLite-backed service path.

## Migration rule

Do not delete native coverage merely because a headless harness exists. Migrate one observable non-native invariant at a time, prove the headless replacement is green, then remove only the redundant native portion. Keep the smallest native proof that still covers genuinely native behavior.
