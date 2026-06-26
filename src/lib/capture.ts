// Tier-1 capture: read the observable page state (form fields, scroll, media
// position). Runs in the content-script / page context. See PRD §5.1.

import type {
  CapturedField,
  CapturedScroll,
  CapturedFile,
  CapturedFileInput,
  Tier1State,
} from './types';
import { selectorFor } from './selectors';

// Per-file size cap for v1 (PRD open question on storage). Larger files are
// skipped and reported rather than silently dropped.
const MAX_FILE_BYTES = 25 * 1024 * 1024; // 25 MB

// Field types we never capture by default — passwords and likely-sensitive
// inputs (PRD §8). The user can opt in per field later (Phase 2).
const SENSITIVE_TYPES = new Set(['password']);
const SENSITIVE_NAME_RE = /pass|card|cvv|cvc|ssn|secret|otp|pin/i;

function labelFor(el: Element): string | undefined {
  const id = el.id;
  if (id) {
    const lbl = document.querySelector(`label[for="${CSS.escape(id)}"]`);
    if (lbl?.textContent) return lbl.textContent.trim().slice(0, 80);
  }
  const wrapping = el.closest('label');
  if (wrapping?.textContent) return wrapping.textContent.trim().slice(0, 80);
  const aria = el.getAttribute('aria-label') || el.getAttribute('placeholder');
  return aria?.trim().slice(0, 80) || undefined;
}

function isSensitive(el: Element): boolean {
  const type = (el.getAttribute('type') || '').toLowerCase();
  if (SENSITIVE_TYPES.has(type)) return true;
  const name = `${el.getAttribute('name') || ''} ${el.id || ''}`;
  return SENSITIVE_NAME_RE.test(name);
}

function captureFields(): CapturedField[] {
  const fields: CapturedField[] = [];

  const inputs = document.querySelectorAll<HTMLInputElement>('input');
  inputs.forEach((el) => {
    const type = (el.type || 'text').toLowerCase();
    if (type === 'hidden' || type === 'file' || type === 'submit' || type === 'button') {
      return; // file handled in Phase 2; the rest aren't user content
    }
    if (isSensitive(el)) return;

    if (type === 'checkbox' || type === 'radio') {
      fields.push({
        selector: selectorFor(el),
        kind: type,
        name: el.name || undefined,
        value: String(el.checked),
        label: labelFor(el),
      });
    } else {
      if (el.value === '') return;
      fields.push({
        selector: selectorFor(el),
        kind: 'text',
        name: el.name || undefined,
        value: el.value,
        label: labelFor(el),
      });
    }
  });

  document.querySelectorAll<HTMLTextAreaElement>('textarea').forEach((el) => {
    if (isSensitive(el) || el.value === '') return;
    fields.push({
      selector: selectorFor(el),
      kind: 'text',
      name: el.name || undefined,
      value: el.value,
      label: labelFor(el),
    });
  });

  document.querySelectorAll<HTMLSelectElement>('select').forEach((el) => {
    if (isSensitive(el)) return;
    const selected = Array.from(el.selectedOptions).map((o) => o.value);
    fields.push({
      selector: selectorFor(el),
      kind: 'select',
      name: el.name || undefined,
      value: el.value,
      selectedValues: el.multiple ? selected : undefined,
      label: labelFor(el),
    });
  });

  document
    .querySelectorAll<HTMLElement>('[contenteditable=""], [contenteditable="true"]')
    .forEach((el) => {
      const html = el.innerHTML.trim();
      if (!html) return;
      fields.push({
        selector: selectorFor(el),
        kind: 'contenteditable',
        value: html,
        label: labelFor(el),
      });
    });

  return fields;
}

function captureScroll(): CapturedScroll[] {
  const scroll: CapturedScroll[] = [];
  if (window.scrollX || window.scrollY) {
    scroll.push({ selector: 'window', x: window.scrollX, y: window.scrollY });
  }
  // Scrollable inner containers that the user has moved.
  document.querySelectorAll<HTMLElement>('*').forEach((el) => {
    if ((el.scrollTop || el.scrollLeft) && el.scrollHeight > el.clientHeight) {
      scroll.push({ selector: selectorFor(el), x: el.scrollLeft, y: el.scrollTop });
    }
  });
  return scroll;
}

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

async function captureFiles(
  skipped: { name: string; size: number }[],
): Promise<CapturedFileInput[]> {
  const inputs = document.querySelectorAll<HTMLInputElement>('input[type="file"]');
  const result: CapturedFileInput[] = [];

  for (const el of inputs) {
    if (!el.files || el.files.length === 0) continue;
    const captured: CapturedFile[] = [];
    for (const file of Array.from(el.files)) {
      if (file.size > MAX_FILE_BYTES) {
        skipped.push({ name: file.name, size: file.size });
        continue;
      }
      try {
        captured.push({
          name: file.name,
          type: file.type,
          size: file.size,
          dataUrl: await readAsDataUrl(file),
        });
      } catch {
        skipped.push({ name: file.name, size: file.size });
      }
    }
    if (captured.length > 0) {
      result.push({
        selector: selectorFor(el),
        name: el.name || undefined,
        label: labelFor(el),
        files: captured,
      });
    }
  }
  return result;
}

function captureMediaTime(): number | undefined {
  const media = document.querySelector<HTMLMediaElement>('video, audio');
  if (media && media.currentTime > 0) return media.currentTime;
  return undefined;
}

/** Capture the full Tier-1 state of the current page. */
export async function captureTier1(): Promise<Tier1State> {
  const skippedFiles: { name: string; size: number }[] = [];
  const files = await captureFiles(skippedFiles);
  return {
    fields: captureFields(),
    scroll: captureScroll(),
    files,
    skippedFiles: skippedFiles.length > 0 ? skippedFiles : undefined,
    mediaTime: captureMediaTime(),
  };
}
