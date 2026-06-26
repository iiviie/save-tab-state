// Tier-1 restore: re-apply captured page state. Runs in the content-script /
// page context. Handles SPA timing via retry-with-backoff rather than a fixed
// delay (PRD §6.6): elements may not exist until the app hydrates.

import type { CapturedField, Tier1State } from './types';
import { findElement } from './selectors';

/** Result of a restore attempt, for honest UI reporting (PRD §10). */
export interface RestoreReport {
  applied: number;
  missing: number;
  total: number;
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
  maxAttempts = 10,
): Promise<RestoreReport> {
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

  applyScroll(state);
  applyMedia(state);

  return {
    applied,
    missing: pending.length,
    total: state.fields.length,
  };
}
