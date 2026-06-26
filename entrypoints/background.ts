// Background service worker: orchestrates user commands from the popup/dashboard.
//
//  save-current     -> ask the active tab's content script to capture, store it
//  restore-snapshot -> open the saved URL, wait for load, tell content to apply
//  list/delete      -> straight storage operations

import {
  putSnapshot,
  getSnapshot,
  listSnapshots,
  deleteSnapshot,
  putWorkspace,
  listWorkspaces,
  deleteWorkspace,
  getSiteSetting,
  listSiteSettings,
  putSiteSetting,
} from '@/src/lib/storage';
import type {
  BackgroundCommand,
  CaptureResponse,
  ApplyResponse,
  SaveResult,
  RestoreResult,
  ListResult,
  SimpleResult,
  ListTabsResult,
  ListWorkspacesResult,
  SaveWorkspaceResult,
  RestoreWorkspaceResult,
  TabInfo,
  WorkspaceView,
  SiteSettingResult,
  ListSiteSettingsResult,
} from '@/src/lib/messaging';
import type { Snapshot, Workspace, SiteSetting, Tier1State } from '@/src/lib/types';

/** Default opt-in state for an origin we've never seen. */
function defaultSetting(origin: string): SiteSetting {
  return { origin, enabled: false, autoSave: false };
}

async function getActiveTab(): Promise<Browser.tabs.Tab | undefined> {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  return tab;
}

/** Capture one tab's Tier-1 state into a stored Snapshot. Throws on failure. */
async function captureTabToSnapshot(
  tabId: number,
  fallbackTitle?: string,
  name?: string,
): Promise<Snapshot> {
  const capture = (await browser.tabs.sendMessage(tabId, {
    type: 'capture-tier1',
  })) as CaptureResponse;

  const url = new URL(capture.url);
  const snapshot: Snapshot = {
    id: crypto.randomUUID(),
    url: capture.url,
    origin: url.origin,
    title: capture.title || fallbackTitle || url.hostname,
    name,
    createdAt: Date.now(),
    tier1: capture.state,
  };
  await putSnapshot(snapshot);
  return snapshot;
}

async function saveCurrent(name?: string): Promise<SaveResult> {
  const tab = await getActiveTab();
  if (!tab?.id || !tab.url) return { ok: false, error: 'No active tab.' };
  try {
    const snapshot = await captureTabToSnapshot(tab.id, tab.title, name);
    return { ok: true, snapshot };
  } catch {
    return {
      ok: false,
      error: 'Could not reach the page. Reload it and try again.',
    };
  }
}

/** Resolve once the given tab reports status === 'complete'. */
function waitForLoad(tabId: number, timeoutMs = 30_000): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      browser.tabs.onUpdated.removeListener(listener);
      reject(new Error('Timed out waiting for the page to load.'));
    }, timeoutMs);

    const listener = (
      updatedTabId: number,
      info: Browser.tabs.OnUpdatedInfo,
    ) => {
      if (updatedTabId === tabId && info.status === 'complete') {
        clearTimeout(timer);
        browser.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    };
    browser.tabs.onUpdated.addListener(listener);
  });
}

/** Open a snapshot's URL in a new tab and apply its Tier-1 state. */
async function openAndRestore(
  snapshot: Snapshot,
  active: boolean,
): Promise<ApplyResponse['report']> {
  const tab = await browser.tabs.create({ url: snapshot.url, active });
  if (!tab.id) throw new Error('Could not open a tab.');
  await waitForLoad(tab.id);
  // Small settle for SPA bootstrapping; restore itself also retries.
  await new Promise((r) => setTimeout(r, 300));
  const res = (await browser.tabs.sendMessage(tab.id, {
    type: 'apply-tier1',
    state: snapshot.tier1,
  })) as ApplyResponse;
  return res.report;
}

async function restore(id: string): Promise<RestoreResult> {
  const snapshot = await getSnapshot(id);
  if (!snapshot) return { ok: false, error: 'Snapshot not found.' };
  try {
    const report = await openAndRestore(snapshot, true);
    return { ok: true, report };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

// --- Workspaces ---

async function getOpenTabs(): Promise<TabInfo[]> {
  const tabs = await browser.tabs.query({ currentWindow: true });
  return tabs
    .filter((t): t is Browser.tabs.Tab & { id: number; url: string } =>
      Boolean(t.id && t.url && /^https?:/.test(t.url)),
    )
    .map((t) => ({
      id: t.id,
      title: t.title || t.url,
      url: t.url,
      favIconUrl: t.favIconUrl,
    }));
}

async function saveWorkspace(
  name: string,
  tabIds: number[],
): Promise<SaveWorkspaceResult> {
  if (tabIds.length === 0) return { ok: false, error: 'No tabs selected.' };

  const snapshotIds: string[] = [];
  for (const tabId of tabIds) {
    try {
      const snap = await captureTabToSnapshot(tabId);
      snapshotIds.push(snap.id);
    } catch {
      // Skip tabs we can't reach (e.g. not yet loaded); report the shortfall.
    }
  }
  if (snapshotIds.length === 0) {
    return {
      ok: false,
      error: 'Could not capture any of the selected tabs.',
      requested: tabIds.length,
      captured: 0,
    };
  }

  const now = Date.now();
  const workspace: Workspace = {
    id: crypto.randomUUID(),
    name: name.trim() || `Workspace ${new Date(now).toLocaleDateString()}`,
    createdAt: now,
    updatedAt: now,
    snapshotIds,
  };
  await putWorkspace(workspace);
  return {
    ok: true,
    workspace,
    captured: snapshotIds.length,
    requested: tabIds.length,
  };
}

async function getWorkspaces(): Promise<ListWorkspacesResult> {
  const [workspaces, snapshots] = await Promise.all([
    listWorkspaces(),
    listSnapshots(),
  ]);
  const byId = new Map(snapshots.map((s) => [s.id, s]));
  const views: WorkspaceView[] = workspaces
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .map((workspace) => ({
      workspace,
      snapshots: workspace.snapshotIds
        .map((id) => byId.get(id))
        .filter((s): s is Snapshot => Boolean(s)),
    }));
  return { ok: true, workspaces: views };
}

async function restoreWorkspace(id: string): Promise<RestoreWorkspaceResult> {
  const workspaces = await listWorkspaces();
  const workspace = workspaces.find((w) => w.id === id);
  if (!workspace) return { ok: false, error: 'Workspace not found.' };

  const reports: RestoreWorkspaceResult['reports'] = [];
  for (const snapshotId of workspace.snapshotIds) {
    const snapshot = await getSnapshot(snapshotId);
    if (!snapshot) {
      reports.push({ snapshotId, error: 'Snapshot missing.' });
      continue;
    }
    try {
      // Open each in the background so they don't steal focus mid-restore.
      const report = await openAndRestore(snapshot, false);
      reports.push({ snapshotId, report });
    } catch (err) {
      reports.push({ snapshotId, error: (err as Error).message });
    }
  }
  return { ok: true, reports };
}

// --- Site settings & auto-save ---

async function autoSave(
  url: string,
  title: string,
  state: Tier1State,
): Promise<SimpleResult> {
  const origin = new URL(url).origin;
  const setting = await getSiteSetting(origin);
  if (!setting?.enabled || !setting.autoSave) {
    return { ok: false, error: 'Auto-save not enabled for this site.' };
  }

  // Dedupe: replace the existing auto snapshot for this exact URL, if any.
  const existing = (await listSnapshots()).find(
    (s) => s.auto && s.url === url,
  );
  const snapshot: Snapshot = {
    id: existing?.id ?? crypto.randomUUID(),
    url,
    origin,
    title: title || new URL(url).hostname,
    createdAt: Date.now(),
    tier1: state,
    auto: true,
  };
  await putSnapshot(snapshot);
  return { ok: true };
}

export default defineBackground(() => {
  browser.runtime.onMessage.addListener(
    (message: BackgroundCommand, _sender, sendResponse) => {
      (async () => {
        switch (message.type) {
          case 'save-current':
            sendResponse(await saveCurrent(message.name));
            break;
          case 'restore-snapshot':
            sendResponse(await restore(message.id));
            break;
          case 'list-snapshots': {
            const snapshots = await listSnapshots();
            snapshots.sort((a, b) => b.createdAt - a.createdAt);
            sendResponse({ ok: true, snapshots } satisfies ListResult);
            break;
          }
          case 'delete-snapshot':
            await deleteSnapshot(message.id);
            sendResponse({ ok: true } satisfies SimpleResult);
            break;
          case 'list-tabs':
            sendResponse({ ok: true, tabs: await getOpenTabs() } satisfies ListTabsResult);
            break;
          case 'save-workspace':
            sendResponse(await saveWorkspace(message.name, message.tabIds));
            break;
          case 'list-workspaces':
            sendResponse(await getWorkspaces());
            break;
          case 'restore-workspace':
            sendResponse(await restoreWorkspace(message.id));
            break;
          case 'delete-workspace':
            await deleteWorkspace(message.id);
            sendResponse({ ok: true } satisfies SimpleResult);
            break;
          case 'get-site-setting': {
            const setting =
              (await getSiteSetting(message.origin)) ??
              defaultSetting(message.origin);
            sendResponse({ ok: true, setting } satisfies SiteSettingResult);
            break;
          }
          case 'set-site-setting':
            await putSiteSetting(message.setting);
            sendResponse({ ok: true } satisfies SimpleResult);
            break;
          case 'list-site-settings':
            sendResponse({
              ok: true,
              settings: await listSiteSettings(),
            } satisfies ListSiteSettingsResult);
            break;
          case 'auto-save':
            sendResponse(await autoSave(message.url, message.title, message.state));
            break;
          default:
            sendResponse({ ok: false, error: 'Unknown command.' });
        }
      })();
      return true; // responses are async
    },
  );
});
