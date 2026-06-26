// Core data model for StateKeep.
//
// State is captured in tiers (see PRD §5). Phase 1 implements Tier 1: the
// observable page/DOM state that an extension can reliably read and re-apply.

/** A single captured form field, keyed by a best-effort stable selector. */
export interface CapturedField {
  /** CSS-ish selector used to relocate the element on restore. */
  selector: string;
  /** Element kind so restore knows how to apply the value. */
  kind: 'text' | 'checkbox' | 'radio' | 'select' | 'contenteditable';
  /** The element's name attribute, if any — used as a fallback matcher. */
  name?: string;
  /** Serialized value. For checkboxes/radios this is "true"/"false". */
  value: string;
  /** For <select multiple>, the set of selected option values. */
  selectedValues?: string[];
  /** Human label guess, for the "what will be saved" preview UI. */
  label?: string;
}

/** Scroll offset for the window or a scrollable container. */
export interface CapturedScroll {
  /** Selector of the scroll container, or "window" for the page itself. */
  selector: string;
  x: number;
  y: number;
}

/** A single uploaded file, stored as a data URL so it survives messaging + IDB. */
export interface CapturedFile {
  name: string;
  type: string;
  size: number;
  /** base64 data URL of the file bytes. */
  dataUrl: string;
}

/** The files attached to one <input type="file">. */
export interface CapturedFileInput {
  selector: string;
  name?: string;
  label?: string;
  files: CapturedFile[];
}

/** The Tier-1 payload captured from a page. */
export interface Tier1State {
  fields: CapturedField[];
  scroll: CapturedScroll[];
  /** File uploads, re-injected on restore via the DataTransfer API. */
  files: CapturedFileInput[];
  /** Files skipped because they exceeded the size cap, for honest reporting. */
  skippedFiles?: { name: string; size: number }[];
  /** Playback position of the first <video>/<audio>, if present (seconds). */
  mediaTime?: number;
}

/**
 * Tier-2 client storage (PRD §5.2): the app's own localStorage/sessionStorage.
 * Restoring this brings back an app's client-side view (drafts, editor content).
 * It also holds auth tokens, which expire — so restore is *additive* (it only
 * sets keys the fresh page lacks) to avoid clobbering a fresh login (PRD §5.3).
 */
export interface Tier2State {
  local: Record<string, string>;
  session: Record<string, string>;
}

/** A snapshot of one page at a point in time. */
export interface Snapshot {
  id: string;
  /** Full URL captured. Restore navigates here first. */
  url: string;
  /** Origin, used for per-site grouping and opt-in checks. */
  origin: string;
  /** Page <title> at capture time, for display. */
  title: string;
  /** Optional user-given name. */
  name?: string;
  /** ms since epoch. */
  createdAt: number;
  /** The captured Tier-1 state. */
  tier1: Tier1State;
  /** The captured Tier-2 client storage, if any. */
  tier2?: Tier2State;
  /** True for snapshots written by auto-save (deduped per URL). */
  auto?: boolean;
  /** Optional data-URL screenshot/thumbnail for previews. */
  thumbnail?: string;
}

/** A named bundle of snapshots that open and restore together. */
export interface Workspace {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  /** Snapshot ids included in this workspace. */
  snapshotIds: string[];
}

/** Per-origin user settings (opt-in model). */
export interface SiteSetting {
  origin: string;
  /** Whether StateKeep may capture on this origin. */
  enabled: boolean;
  /** Whether to auto-save (Phase 2). */
  autoSave: boolean;
}
