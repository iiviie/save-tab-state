import { defineConfig } from 'wxt';
import { resolve } from 'node:path';

// WXT generates a Manifest V3 build for Chrome/Chromium and an MV3 build for
// Firefox from this single config. Run `wxt build` for Chrome and
// `wxt build -b firefox` for Firefox.
export default defineConfig({
  // By default `wxt` (dev mode) launches Chrome with a throwaway profile that
  // is discarded on close — so the extension's IndexedDB (saved snapshots) does
  // NOT survive a restart. Pin a persistent dev profile so data persists across
  // `npm run dev` sessions, matching how a real installed extension behaves.
  webExt: {
    chromiumProfile: resolve('.chrome-dev-profile'),
    keepProfileChanges: true,
  },
  manifest: {
    name: 'StateKeep — Save & Restore Tab State',
    description:
      'Snapshot a website (form fields, scroll, route) and restore it later — even across sessions. Local-first and private.',
    // Per-site opt-in: we request hosts on demand rather than <all_urls>.
    permissions: ['storage', 'tabs', 'scripting', 'activeTab'],
    optional_host_permissions: ['*://*/*'],
    action: {
      default_title: 'StateKeep',
    },
    // The dashboard (full management UI) is the options page.
    options_ui: {
      page: 'dashboard.html',
      open_in_tab: true,
    },
    // Firefox requires an explicit add-on id for some APIs.
    browser_specific_settings: {
      gecko: {
        id: 'statekeep@iiviie.dev',
        // StateKeep is local-first and sends nothing off-device (PRD §8).
        data_collection_permissions: {
          required: ['none'],
        },
      },
    },
  },
});
