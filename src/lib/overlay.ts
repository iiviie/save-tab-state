// In-page restore overlay (PRD §5.3, §6.2, §10).
//
// Shown after a restore so the user sees, honestly, what was applied. Its two
// jobs map to the hardest real-world cases:
//
//   1. Auth expiry — if the page needed a fresh login, fields won't be found on
//      the first pass. The overlay says so and offers a Retry that re-applies
//      the saved state on top of the now-authenticated page. We don't try to
//      guess auth state; the user logs in and clicks Retry.
//
//   2. File re-attach fallback — pages that block synthetic file assignment get
//      download links here so the user can drag the originals back in.
//
// Rendered in a Shadow DOM so the host page's CSS can't distort it.

import type { Tier1State } from './types';
import type { RestoreReport } from './restore';

const HOST_ID = 'statekeep-overlay-host';

export function showRestoreOverlay(
  report: RestoreReport,
  state: Tier1State,
  onRetry: () => void,
): void {
  document.getElementById(HOST_ID)?.remove();

  const host = document.createElement('div');
  host.id = HOST_ID;
  host.style.cssText =
    'all:initial;position:fixed;bottom:16px;right:16px;z-index:2147483647;';
  const shadow = host.attachShadow({ mode: 'open' });

  const needsRetry = report.missing > 0;
  const manualFiles = report.filesNeedingManualReattach > 0;

  const summary =
    `Restored ${report.applied} field${report.applied === 1 ? '' : 's'}` +
    (report.filesRestored > 0 ? `, ${report.filesRestored} file(s)` : '') +
    '.';

  shadow.innerHTML = `
    <style>
      .card {
        font: 13px/1.45 system-ui, sans-serif;
        width: 300px; max-width: 80vw;
        background: #1a1d24; color: #e7e9ee;
        border: 1px solid #2d3340; border-radius: 10px;
        box-shadow: 0 8px 30px rgba(0,0,0,.45);
        overflow: hidden;
      }
      .head {
        display: flex; align-items: center; justify-content: space-between;
        padding: 10px 12px; background: #232733; font-weight: 600;
      }
      .head .x { cursor: pointer; color: #8b91a0; font-size: 15px; }
      .head .x:hover { color: #fff; }
      .body { padding: 12px; display: flex; flex-direction: column; gap: 10px; }
      .summary { color: #e7e9ee; }
      .note { color: #8b91a0; font-size: 12px; }
      button {
        font: inherit; cursor: pointer; border: none; border-radius: 7px;
        padding: 8px 12px; background: #5b8cff; color: #fff; font-weight: 600;
      }
      button:hover { filter: brightness(1.1); }
      .files { display: flex; flex-direction: column; gap: 6px; }
      .files a {
        color: #5b8cff; text-decoration: none; font-size: 12px;
        overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
      }
      .files a:hover { text-decoration: underline; }
    </style>
    <div class="card">
      <div class="head"><span>StateKeep</span><span class="x" id="close">✕</span></div>
      <div class="body">
        <div class="summary">${summary}</div>
        ${
          needsRetry
            ? `<div class="note">${report.missing} field(s) weren't found yet.
                 If this page needs sign-in, log in and then retry.</div>
               <button id="retry">Retry restore</button>`
            : ''
        }
        ${
          manualFiles
            ? `<div class="note">${report.filesNeedingManualReattach} file(s)
                 couldn't be attached automatically. Download and drag them back:</div>
               <div class="files" id="files"></div>`
            : ''
        }
      </div>
    </div>
  `;

  shadow.getElementById('close')?.addEventListener('click', () => host.remove());
  shadow.getElementById('retry')?.addEventListener('click', () => {
    host.remove();
    onRetry();
  });

  if (manualFiles) {
    const filesEl = shadow.getElementById('files')!;
    for (const group of state.files) {
      for (const f of group.files) {
        const a = document.createElement('a');
        a.href = f.dataUrl;
        a.download = f.name;
        a.textContent = `↓ ${f.name}`;
        filesEl.append(a);
      }
    }
  }

  document.documentElement.append(host);
}
