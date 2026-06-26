// Content script: the only code that runs inside the page. It does nothing on
// its own — it waits for the background to ask it to capture or apply Tier-1
// state. Capture/restore only happen on explicit user action on an opted-in
// site (the opt-in gate lives in the background/UI).
//
// NOTE (MVP simplification): registered on <all_urls> so it's always ready to
// respond. It is inert until messaged. Tightening this to runtime registration
// after per-site opt-in is tracked for a later phase (PRD §8, minimal perms).

import { captureTier1 } from '@/src/lib/capture';
import { captureTier2 } from '@/src/lib/tier2';
import { restoreTier1 } from '@/src/lib/restore';
import { showRestoreOverlay } from '@/src/lib/overlay';
import type {
  ContentMessage,
  CaptureResponse,
  ApplyResponse,
  SiteSettingResult,
} from '@/src/lib/messaging';
import type { Tier1State, Tier2State } from '@/src/lib/types';

export default defineContentScript({
  matches: ['<all_urls>'],
  runAt: 'document_idle',
  allFrames: false,
  main() {
    // Apply state and show the honest restore summary overlay. The overlay's
    // Retry re-runs this (e.g. after the user signs in), so we keep the state.
    async function applyAndReport(state: Tier1State, tier2?: Tier2State) {
      const report = await restoreTier1(state, tier2);
      showRestoreOverlay(report, state, () => void applyAndReport(state, tier2));
      return report;
    }

    browser.runtime.onMessage.addListener(
      (message: ContentMessage, _sender, sendResponse) => {
        if (message.type === 'capture-tier1') {
          // Async: reading file uploads uses FileReader.
          captureTier1().then((state) => {
            const response: CaptureResponse = {
              ok: true,
              state,
              tier2: captureTier2(),
              title: document.title,
              url: location.href,
            };
            sendResponse(response);
          });
          return true; // async response
        }

        if (message.type === 'apply-tier1') {
          // Async: restore retries over time, so keep the channel open.
          applyAndReport(message.state, message.tier2).then((report) => {
            const response: ApplyResponse = { ok: true, report };
            sendResponse(response);
          });
          return true; // async response
        }

        return undefined;
      },
    );

    void initAutoSave();
  },
});

/**
 * Auto-save (PRD §7.1): when enabled for this origin, snapshot the page a short
 * debounce after the user edits a form, so a crash/timeout loses almost nothing.
 * Background dedupes auto snapshots per URL.
 */
async function initAutoSave() {
  let setting: SiteSettingResult;
  try {
    setting = (await browser.runtime.sendMessage({
      type: 'get-site-setting',
      origin: location.origin,
    })) as SiteSettingResult;
  } catch {
    return;
  }
  if (!setting.setting?.enabled || !setting.setting.autoSave) return;

  let timer: ReturnType<typeof setTimeout> | undefined;
  let saving = false;

  const trigger = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(async () => {
      if (saving) return;
      saving = true;
      try {
        const state = await captureTier1();
        // Skip empty pages — nothing worth a snapshot yet.
        if (state.fields.length === 0 && state.files.length === 0) return;
        await browser.runtime.sendMessage({
          type: 'auto-save',
          state,
          tier2: captureTier2(),
          title: document.title,
          url: location.href,
        });
      } catch {
        /* tab closing or background asleep — next edit retries */
      } finally {
        saving = false;
      }
    }, 1500);
  };

  document.addEventListener('input', trigger, { capture: true, passive: true });
  document.addEventListener('change', trigger, { capture: true, passive: true });
}
