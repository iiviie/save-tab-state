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
} from '@/src/lib/storage';
import type {
  BackgroundCommand,
  CaptureResponse,
  ApplyResponse,
  SaveResult,
  RestoreResult,
  ListResult,
  SimpleResult,
} from '@/src/lib/messaging';
import type { Snapshot } from '@/src/lib/types';

async function getActiveTab(): Promise<Browser.tabs.Tab | undefined> {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  return tab;
}

async function saveCurrent(name?: string): Promise<SaveResult> {
  const tab = await getActiveTab();
  if (!tab?.id || !tab.url) return { ok: false, error: 'No active tab.' };

  let capture: CaptureResponse;
  try {
    capture = (await browser.tabs.sendMessage(tab.id, {
      type: 'capture-tier1',
    })) as CaptureResponse;
  } catch {
    return {
      ok: false,
      error: 'Could not reach the page. Reload it and try again.',
    };
  }

  const url = new URL(capture.url);
  const snapshot: Snapshot = {
    id: crypto.randomUUID(),
    url: capture.url,
    origin: url.origin,
    title: capture.title || tab.title || url.hostname,
    name,
    createdAt: Date.now(),
    tier1: capture.state,
  };
  await putSnapshot(snapshot);
  return { ok: true, snapshot };
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

async function restore(id: string): Promise<RestoreResult> {
  const snapshot = await getSnapshot(id);
  if (!snapshot) return { ok: false, error: 'Snapshot not found.' };

  const tab = await browser.tabs.create({ url: snapshot.url, active: true });
  if (!tab.id) return { ok: false, error: 'Could not open a tab.' };

  try {
    await waitForLoad(tab.id);
    // Small settle for SPA bootstrapping; restore itself also retries.
    await new Promise((r) => setTimeout(r, 300));
    const res = (await browser.tabs.sendMessage(tab.id, {
      type: 'apply-tier1',
      state: snapshot.tier1,
    })) as ApplyResponse;
    return { ok: true, report: res.report };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
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
          default:
            sendResponse({ ok: false, error: 'Unknown command.' });
        }
      })();
      return true; // responses are async
    },
  );
});
