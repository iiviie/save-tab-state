// Tier-2 client storage capture/restore (PRD §5.2). Runs in the page context.
//
// Restore is deliberately *additive*: we only write keys the current page
// doesn't already have. This is the safe generic answer to the auth-expiry
// problem (PRD §5.3) — a freshly logged-in page has already written a valid
// token to storage, and we must not overwrite it with the stale saved one.

import type { Tier2State } from './types';

function readStore(store: Storage): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < store.length; i++) {
    const key = store.key(i);
    if (key == null) continue;
    const value = store.getItem(key);
    if (value != null) out[key] = value;
  }
  return out;
}

export function captureTier2(): Tier2State {
  try {
    return {
      local: readStore(window.localStorage),
      session: readStore(window.sessionStorage),
    };
  } catch {
    // Storage can throw (disabled cookies, sandboxed frame).
    return { local: {}, session: {} };
  }
}

/** Additively apply saved storage. Returns how many keys were newly written. */
export function restoreTier2(state: Tier2State | undefined): number {
  if (!state) return 0;
  let added = 0;
  const apply = (store: Storage, data: Record<string, string>) => {
    for (const [key, value] of Object.entries(data)) {
      try {
        if (store.getItem(key) === null) {
          store.setItem(key, value);
          added++;
        }
      } catch {
        /* quota or security error — skip this key */
      }
    }
  };
  try {
    apply(window.localStorage, state.local);
    apply(window.sessionStorage, state.session);
  } catch {
    /* storage unavailable */
  }
  return added;
}
