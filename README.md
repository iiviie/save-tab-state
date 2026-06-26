# StateKeep — Save & Restore Tab State

A cross-browser (Chrome / Chromium / Firefox) extension that snapshots a website's
state — form fields, scroll position, route — and restores it later, even across
browser sessions. Local-first and private by design.

See [`PRD.md`](./PRD.md) for the full product spec, the tiered state model, and the
roadmap.

## Status

Early development, but functional. Implemented so far:

- **Tier-1 capture/restore** — form fields, scroll position, media playback time
- **File uploads** survive a restore (re-injected via `DataTransfer`, 25 MB/file cap)
- **Tier-2 storage** — `localStorage` / `sessionStorage`, restored additively so a
  fresh login token is never clobbered
- **Workspaces** — bundle several open tabs and restore them together
- **Restore overlay** — honest "what restored" summary, Retry-after-login, file
  re-attach download fallback, reload hint for storage
- **Per-site opt-in** + **auto-save** for forms on enabled sites
- Local-first (IndexedDB), no network calls

Not yet: encryption at rest, cookies, export/import, cross-device sync. See
[`PRD.md`](./PRD.md).

## Tech

- [WXT](https://wxt.dev) — cross-browser web-extension framework (MV3, Chrome + Firefox).
- TypeScript, vanilla UI (no heavy framework yet).
- IndexedDB for local snapshot storage.

## Develop

```bash
npm install

# Chrome / Chromium (default)
npm run dev

# Firefox
npm run dev:firefox
```

`wxt` opens a browser with the extension loaded and hot-reloads on change.

## Build

```bash
npm run build           # Chrome/Chromium -> .output/chrome-mv3
npm run build:firefox   # Firefox        -> .output/firefox-mv3
npm run zip             # packaged zip for the Chrome Web Store
npm run zip:firefox     # packaged zip for AMO
```

## Type-check

```bash
npm run compile
```

## License

MIT
