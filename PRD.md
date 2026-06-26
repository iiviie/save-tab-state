# PRD: StateKeep — Save & Restore Website State

**Status:** Draft v0.2
**Author:** divyansh@crosmos.dev
**Last updated:** 2026-06-26

**Decisions locked (2026-06-26):**
- **Storage:** Local-only for v1. No accounts, no cross-device sync. Encryption at rest still applies. Sync is post-v1.
- **Fidelity:** Fully generic capture for v1. No per-app adapters — best-effort everywhere. Adapters are post-v1.
- **Browsers:** Chrome/Chromium **and** Firefox from day one, via `webextension-polyfill`. Cross-browser QA is part of every phase, not a separate port phase.

---

## 1. Summary

StateKeep is a cross-browser (Chrome / Chromium / Firefox) extension that lets a user **snapshot the state of a website and restore it later** — even after closing the tab, restarting the browser, or days passing.

It started as a "save my form so I don't lose it" tool, but the same mechanism solves a broader class of problems: resuming half-finished work, reopening a research session, picking up a multi-tab workflow exactly where you left off.

Two units of work:

- **Snapshot** — the saved state of a single page/site.
- **Workspace** — a named bundle of multiple snapshots that open and restore together.

---

## 2. Problem

People lose in-progress work constantly:

- Long forms with no autosave — a crash, accidental back-button, or session timeout wipes everything.
- Multi-field flows (job applications, government portals, insurance, tax) that take 30+ minutes.
- Research sessions spread across many tabs — closing the browser means rebuilding context from scratch.
- Returning to a task tomorrow means reopening 5 sites and re-navigating each to the right place.

Browsers offer "restore tabs," but that only reopens **URLs** — it does not restore what you'd *typed*, *scrolled to*, *uploaded*, or *filled in*.

---

## 3. Goals / Non-Goals

### Goals
- Capture and restore the **recoverable** state of a page: form inputs, file attachments, scroll position, route/URL, and per-origin web storage.
- Handle the **auth-expiry reality**: tokens/sessions will expire. Restore should gracefully let the user re-authenticate, then re-apply the saved state on top.
- Support **file/media attachments** in forms so uploads survive a restore.
- Support **Workspaces**: select multiple sites, preview them, save as a set, and restore the whole set at once.
- Be **cross-browser** on Manifest V3 (Chrome/Chromium) and the Firefox WebExtensions port.
- Be **privacy-first**: data is sensitive (it's literally what you typed). Local-first by default, encrypted at rest, opt-in per site.

### Non-Goals (v1)
- Capturing arbitrary **in-memory JavaScript state** of an app (e.g. a game's runtime, a canvas drawing, ephemeral React state with no DOM/storage backing). This is generally impossible to do generically — see §6.
- Replaying server-side state. We restore what the *client* can hold; we do not snapshot the backend.
- Real-time multi-device sync — **explicitly out for v1; local-only** (post-v1, see §11).
- Per-app adapters (YouTube/Docs/Gmail-specific handlers) — **out for v1; generic capture only**.
- Keeping sessions/tokens *alive* in the background (we restore-then-reauth instead — see §5.3).

---

## 4. Target Users & Use Cases

| User | Use case |
|------|----------|
| Job seeker / applicant | Half-finished application form across sessions |
| Researcher / student | A cluster of reference tabs + scroll positions saved as a workspace |
| Knowledge worker | 5 dashboards/tools open at once, saved and reopened as a "Monday morning" workspace |
| Anyone filling gov/insurance/tax forms | Long forms with uploads, resumed days later |
| Content consumer | Resume a video/article roughly where they left off (best-effort) |

---

## 5. What "State" Means (the core model)

A website's state is spread across several layers. StateKeep captures them in **tiers**, ordered by reliability. We are explicit about which tier a snapshot achieves so the UI can set honest expectations.

### 5.1 Tier 1 — Page / DOM state (most reliable, always attempted)
- All form fields: `<input>`, `<textarea>`, `<select>`, checkboxes, radios, contenteditable regions.
- Custom inputs where possible (rich-text editors, some component libraries) — best-effort via DOM heuristics.
- Scroll position (window + scrollable containers).
- Current URL / route (incl. SPA hash/history routes).
- Active tab/accordion/step where it's reflected in the DOM or URL.

### 5.2 Tier 2 — Web storage & cookies (restores "where the app thinks you are")
- `localStorage`, `sessionStorage` per origin.
- `IndexedDB` (drafts, offline data, editor content).
- Cookies (optional, sensitive — off by default, see §8).

This tier is what restores a SPA's client-side view. **But** it's also where auth tokens live, and those expire — handled in §5.3.

### 5.3 Auth / token expiry (the YouTube-at-3:18 problem)

Saved tokens are very likely **stale** by restore time. We do **not** try to keep them fresh in the background. Instead:

**Restore flow:**
1. Open the saved URL.
2. Detect whether the user is authenticated (heuristics: presence of a known login control, redirect to a login page, or a saved "auth-required" flag for this origin).
3. **If auth is needed:** show a small overlay — *"Sign in to continue, then we'll restore your saved content."* The user logs in normally (fresh, valid token).
4. **After auth:** StateKeep re-applies the Tier 1 state (form fields, scroll, route) and any non-auth Tier 2 data on top of the now-valid session.

So the saved snapshot is treated as a **content overlay**, decoupled from credentials. We restore *what you were doing*, not *who you were authenticated as*.

For the video case specifically: we save the URL + a **playback position** (`currentTime`) and, on restore, seek to it after the page/player is ready — independent of any token.

### 5.4 What we deliberately *don't* promise
- Pixel-perfect restoration of every app. We restore inputs and recoverable client state, not the full server-rendered world.
- In-memory-only JS state with no DOM/storage footprint (§6).

---

## 6. Hard Technical Realities (read before scoping)

These shape what v1 can honestly deliver:

1. **In-memory JS state is largely uncapturable generically.** If an app holds state only in JS variables / React state that never touches the DOM or storage, an extension can't read it. We capture the *observable* surface (DOM + storage). Mitigation: snapshot frequently from the rendered DOM; document the limitation.

2. **File inputs cannot be programmatically refilled the naive way.** For security, you can't set `<input type=file>.value`. We work around it by:
   - Storing the actual file bytes (Blob) in IndexedDB at save time.
   - On restore, reconstructing a `File`/`DataTransfer` and assigning `input.files` via the `DataTransfer` API where the page allows it, then dispatching `input`/`change` events.
   - Fallback when a page rejects synthetic file assignment: surface the saved files in our overlay as **one-click re-attach / download**, so the user can re-drop them. Honest degradation rather than silent failure.

3. **Cross-origin & iframes.** Content scripts are per-origin; iframed widgets (payment fields, embedded editors) may be inaccessible. Capture what we can, flag what we can't.

4. **Cookies & httpOnly.** httpOnly cookies are invisible to content scripts; only reachable via the `cookies` permission in the background script, and storing them is a security risk. Off by default.

5. **CSP and sandboxing** can block injected restoration scripts on some sites. Need a fallback path and clear per-site failure reporting.

6. **SPA timing.** Restoring before the app has hydrated breaks. Need a readiness strategy (mutation observers, retry-with-backoff, waiting for known selectors) rather than a fixed delay.

7. **Storage size.** Snapshots with media can be large (uploaded videos!). Need quotas, compression, and eviction policy.

---

## 7. Features

### 7.1 Single-page Snapshot
- **Save State** — one click (toolbar button / context menu / keyboard shortcut) captures the current page.
- **Auto-save (opt-in per site)** — periodic/event-driven snapshots (on input, on blur, every N seconds) so a crash loses little.
- **Restore** — reopen the page and apply the snapshot, running the auth-aware flow (§5.3).
- **Named snapshots & history** — multiple versions per page; restore any prior version.

### 7.2 Form-focused mode
- Smart detection of forms on the page; highlight which fields will be saved.
- Capture and restore file/media uploads (§6.2).
- "Never lose this form" badge while typing in a tracked form.

### 7.3 Workspaces
- **Create workspace** — pick which of the currently open tabs to include (multi-select with checkboxes).
- **Preview** — thumbnail/screenshot + title + URL for each included site before saving; let the user deselect any.
- **Save workspace** — snapshots all selected sites as one named bundle.
- **Restore workspace** — opens every site in the bundle (new window or tab group) and runs each site's restore flow, including per-site auth where needed.
- **Manage** — rename, update (re-snapshot), delete, duplicate workspaces.

### 7.4 Management UI
- Popup: quick save / restore / "save to workspace".
- Full-page dashboard: list of snapshots & workspaces, search, storage usage, per-site settings, export/import.

---

## 8. Privacy & Security (first-class, not an afterthought)

This extension stores **exactly the sensitive stuff** — what you typed, uploaded, and your client storage. Trust is the product.

- **Local-first by default.** All data stays on-device (IndexedDB) unless the user explicitly opts into sync.
- **Encryption at rest.** Snapshots encrypted with a key derived from a user passphrase (WebCrypto). Optional but recommended; required for any future sync.
- **Per-site opt-in / allowlist.** Nothing is captured on a site until the user enables it there. Optional blocklist for sensitive domains (banking, healthcare) prompts an extra confirm.
- **Sensitive-field handling.** Password fields and detected card/SSN-like fields are **excluded by default**; user can override per field.
- **Cookies & tokens off by default**, with a clear warning when enabled.
- **Transparent capture.** Always show what a snapshot contains; one-click "view / redact fields" before saving.
- **Easy delete.** Purge a snapshot, a site's data, or everything, instantly.
- **Minimal permissions.** Request host permissions per-site (activeTab + opt-in origins) rather than `<all_urls>` where feasible.

---

## 9. Architecture (high-level)

- **Manifest V3** with a WebExtensions-compatible structure for the Firefox port.
- **Content script** (per allowed origin): reads/writes DOM, form fields, scroll, page storage, runs restoration with readiness retries.
- **Background service worker**: orchestration, storage management, cookies API (if enabled), workspace open/restore sequencing, encryption.
- **Storage layer**: IndexedDB for snapshots + file blobs; `chrome.storage` for settings/index.
- **UI**: popup (quick actions) + options/dashboard page (likely a small framework: React/Svelte/Vanilla TBD).
- **Cross-browser shim**: `webextension-polyfill` to bridge Chrome `chrome.*` callbacks vs Firefox promise-based `browser.*`.

### Key flows
- **Capture:** content script serializes Tier 1 → background collects Tier 2 (storage, optional cookies) → encrypt → store, with file blobs in IndexedDB.
- **Restore:** open URL → detect auth → (re-auth if needed) → inject Tier 2 → wait for readiness → apply Tier 1 → re-attach files → seek media.

---

## 10. UX Principles

- **Honest tiers.** The UI tells the user what was captured ("Form fields + scroll saved. Login will be required on restore.") rather than over-promising "full state."
- **One-click common path**, depth available in the dashboard.
- **Non-intrusive.** A small overlay during restore, never a blocking modal that hijacks the page (also avoids breaking the page's own dialogs).
- **Graceful degradation.** When something can't be auto-restored (files, a CSP-blocked field), surface it for manual one-click fix instead of failing silently.

---

## 11. Success Metrics

- % of restores where the user keeps the restored content (didn't have to redo work).
- Form-field restoration fidelity (fields restored / fields captured).
- File re-attach success rate (auto vs manual fallback).
- Workspace restore completion rate (sites restored / sites in bundle).
- Retention: weekly active savers; snapshots restored per user.

---

## 12. Roadmap / Phasing

**Phase 0 — Spike (validate the hard parts)**
- Prove file re-attach via `DataTransfer` on 5 representative sites.
- Prove SPA restore timing strategy on 2–3 SPAs.
- Prove auth-then-restore overlay flow on one token-gated site.

**Phase 1 — MVP (single-page, Chrome + Firefox)**
- Tier 1 capture/restore (form fields, scroll, URL).
- Manual save/restore, per-site opt-in, basic dashboard.
- Local encrypted storage. Cross-browser via `webextension-polyfill` from this phase on.

**Phase 2 — Forms & files**
- File/media capture + re-attach with fallback.
- Auto-save, sensitive-field exclusion, snapshot history.

**Phase 3 — Tier 2 & auth flow**
- localStorage/sessionStorage/IndexedDB capture.
- Auth-aware restore overlay; media playback-position resume.

**Phase 4 — Workspaces**
- Multi-select, preview, save/restore bundles, sequenced per-site restore.

**Phase 5 — Polish & hardening**
- Cross-browser QA pass (Chrome + Firefox have been built in parallel throughout), perf, storage eviction, edge-case sites.

**Post-v1**
- Optional end-to-end-encrypted cross-device sync (introduces account model).
- Per-app adapters for popular sites where generic capture is weak (YouTube, Google Docs, Gmail).

---

## 13. Open Questions

*(Resolved: sync → local-only v1; adapters → generic-only v1; browsers → Chrome + Firefox from day one. See header.)*

1. **Media uploads in storage:** what's the per-snapshot/global size cap, and eviction policy when large videos are involved?
2. **Monetization / distribution:** free, freemium (workspaces/sync paid?), open source?
3. **Detecting "auth required"** reliably across arbitrary sites — heuristic confidence threshold and manual override UX.
4. **Naming/brand** — "StateKeep" is a placeholder.
