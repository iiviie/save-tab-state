// Tier-1 restore: re-apply captured page state. Runs in the content-script /
// page context. Handles SPA timing via retry-with-backoff rather than a fixed
// delay (PRD §6.6): elements may not exist until the app hydrates.

import type { CapturedField, CapturedFile, Tier1State, Tier2State } from './types';
import { findElement } from './selectors';
import { restoreTier2 } from './tier2';

/** Result of a restore attempt, for honest UI reporting (PRD §10). */
export interface RestoreReport {
  applied: number;
  missing: number;
  total: number;
  /** Files re-attached to their inputs. */
  filesRestored: number;
  /** Files we held but the page refused to accept (manual re-attach needed). */
  filesNeedingManualReattach: number;
  /** Tier-2 storage keys additively written (may need a reload to take effect). */
  tier2KeysAdded: number;
}

function fire(el: Element, type: string): void {
  el.dispatchEvent(new Event(type, { bubbles: true }));
}

function applyField(field: CapturedField): boolean {
  const el = findElement(field.selector, field.name);
  if (!el) return false;

  switch (field.kind) {
    case 'text': {
      const input = el as HTMLInputElement | HTMLTextAreaElement;
      input.value = field.value;
      fire(input, 'input');
      fire(input, 'change');
      return true;
    }
    case 'checkbox':
    case 'radio': {
      const input = el as HTMLInputElement;
      input.checked = field.value === 'true';
      fire(input, 'click');
      fire(input, 'change');
      return true;
    }
    case 'select': {
      const select = el as HTMLSelectElement;
      if (field.selectedValues) {
        const wanted = new Set(field.selectedValues);
        Array.from(select.options).forEach((o) => (o.selected = wanted.has(o.value)));
      } else {
        select.value = field.value;
      }
      fire(select, 'change');
      return true;
    }
    case 'contenteditable': {
      (el as HTMLElement).innerHTML = field.value;
      fire(el, 'input');
      return true;
    }
    default:
      return false;
  }
}

/** Turn a stored data URL back into a File object. */
async function fileFromCapture(captured: CapturedFile): Promise<File> {
  const res = await fetch(captured.dataUrl);
  const blob = await res.blob();
  return new File([blob], captured.name, {
    type: captured.type || blob.type,
  });
}

/**
 * Re-attach captured files to their <input type="file"> via DataTransfer.
 * Some sites reject programmatic file assignment; we count those as needing a
 * manual re-attach rather than failing silently (PRD §6.2).
 */
async function applyFiles(
  state: Tier1State,
): Promise<{ restored: number; manual: number }> {
  let restored = 0;
  let manual = 0;

  for (const group of state.files) {
    const el = findElement(group.selector, group.name) as HTMLInputElement | null;
    if (!el || el.type !== 'file') {
      manual += group.files.length;
      continue;
    }
    try {
      const dt = new DataTransfer();
      for (const captured of group.files) {
        dt.items.add(await fileFromCapture(captured));
      }
      el.files = dt.files;
      // Verify the assignment actually took (some pages block it).
      if (el.files.length === group.files.length) {
        fire(el, 'input');
        fire(el, 'change');
        restored += group.files.length;
      } else {
        manual += group.files.length;
      }
    } catch {
      manual += group.files.length;
    }
  }
  return { restored, manual };
}

function applyScroll(state: Tier1State): void {
  for (const s of state.scroll) {
    if (s.selector === 'window') {
      window.scrollTo(s.x, s.y);
    } else {
      const el = findElement(s.selector);
      if (el) {
        el.scrollLeft = s.x;
        el.scrollTop = s.y;
      }
    }
  }
}

function applyMedia(state: Tier1State): void {
  if (state.mediaTime == null) return;
  const media = document.querySelector<HTMLMediaElement>('video, audio');
  if (!media) return;
  const seek = () => {
    try {
      media.currentTime = state.mediaTime!;
    } catch {
      /* not seekable yet */
    }
  };
  if (media.readyState >= 1) seek();
  else media.addEventListener('loadedmetadata', seek, { once: true });
}

/**
 * Apply Tier-1 state, retrying fields that aren't present yet (SPA hydration).
 * Resolves once all fields are applied or `maxAttempts` is exhausted.
 */
export async function restoreTier1(
  state: Tier1State,
  tier2?: Tier2State,
  maxAttempts = 10,
): Promise<RestoreReport> {
  // Apply Tier-2 storage first (additively) so any app that re-reads storage
  // during hydration can pick it up.
  const tier2KeysAdded = restoreTier2(tier2);

  const pending = [...state.fields];
  let applied = 0;

  for (let attempt = 0; attempt < maxAttempts && pending.length > 0; attempt++) {
    for (let i = pending.length - 1; i >= 0; i--) {
      const field = pending[i]!;
      if (applyField(field)) {
        applied++;
        pending.splice(i, 1);
      }
    }
    if (pending.length > 0) {
      // Exponential-ish backoff capped at ~1s between sweeps.
      await new Promise((r) => setTimeout(r, Math.min(100 * 2 ** attempt, 1000)));
    }
  }

  const fileResult = await applyFiles(state);
  applyScroll(state);
  applyMedia(state);

  return {
    applied,
    missing: pending.length,
    total: state.fields.length,
    filesRestored: fileResult.restored,
    filesNeedingManualReattach: fileResult.manual,
    tier2KeysAdded,
  };
}
