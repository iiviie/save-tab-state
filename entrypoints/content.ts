// Content script: the only code that runs inside the page. It does nothing on
// its own — it waits for the background to ask it to capture or apply Tier-1
// state. Capture/restore only happen on explicit user action on an opted-in
// site (the opt-in gate lives in the background/UI).
//
// NOTE (MVP simplification): registered on <all_urls> so it's always ready to
// respond. It is inert until messaged. Tightening this to runtime registration
// after per-site opt-in is tracked for a later phase (PRD §8, minimal perms).

import { captureTier1 } from '@/src/lib/capture';
import { restoreTier1 } from '@/src/lib/restore';
import { showRestoreOverlay } from '@/src/lib/overlay';
import type {
  ContentMessage,
  CaptureResponse,
  ApplyResponse,
} from '@/src/lib/messaging';
import type { Tier1State } from '@/src/lib/types';

export default defineContentScript({
  matches: ['<all_urls>'],
  runAt: 'document_idle',
  allFrames: false,
  main() {
    // Apply state and show the honest restore summary overlay. The overlay's
    // Retry re-runs this (e.g. after the user signs in), so we keep the state.
    async function applyAndReport(state: Tier1State) {
      const report = await restoreTier1(state);
      showRestoreOverlay(report, state, () => void applyAndReport(state));
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
              title: document.title,
              url: location.href,
            };
            sendResponse(response);
          });
          return true; // async response
        }

        if (message.type === 'apply-tier1') {
          // Async: restore retries over time, so keep the channel open.
          applyAndReport(message.state).then((report) => {
            const response: ApplyResponse = { ok: true, report };
            sendResponse(response);
          });
          return true; // async response
        }

        return undefined;
      },
    );
  },
});
