// Popup: quick save of the current page + restore/delete recent snapshots.

import type {
  SaveResult,
  ListResult,
  RestoreResult,
  SimpleResult,
} from '@/src/lib/messaging';
import type { Snapshot } from '@/src/lib/types';

const $ = <T extends HTMLElement>(id: string): T =>
  document.getElementById(id) as T;

const nameInput = $<HTMLInputElement>('name');
const saveBtn = $<HTMLButtonElement>('save');
const statusEl = $<HTMLParagraphElement>('status');
const listEl = $<HTMLUListElement>('snapshots');
const emptyEl = $<HTMLParagraphElement>('empty');

function setStatus(text: string, kind: 'ok' | 'err' | '' = ''): void {
  statusEl.textContent = text;
  statusEl.className = `status ${kind}`;
  statusEl.hidden = !text;
}

function relativeTime(ts: number): string {
  const diff = Date.now() - ts;
  const min = Math.round(diff / 60_000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  return new Date(ts).toLocaleDateString();
}

function render(snapshots: Snapshot[]): void {
  listEl.innerHTML = '';
  emptyEl.hidden = snapshots.length > 0;

  for (const snap of snapshots) {
    const li = document.createElement('li');

    const info = document.createElement('div');
    info.className = 'info';
    const title = document.createElement('span');
    title.className = 'title';
    title.textContent = snap.name || snap.title || snap.url;
    title.title = snap.url;
    const meta = document.createElement('span');
    meta.className = 'meta';
    const host = new URL(snap.url).hostname;
    meta.textContent = `${host} · ${snap.tier1.fields.length} fields · ${relativeTime(snap.createdAt)}`;
    info.append(title, meta);

    const actions = document.createElement('div');
    actions.className = 'actions';
    const restoreBtn = document.createElement('button');
    restoreBtn.textContent = 'Restore';
    restoreBtn.onclick = () => restore(snap.id);
    const delBtn = document.createElement('button');
    delBtn.textContent = '✕';
    delBtn.className = 'del';
    delBtn.title = 'Delete';
    delBtn.onclick = () => remove(snap.id);
    actions.append(restoreBtn, delBtn);

    li.append(info, actions);
    listEl.append(li);
  }
}

async function refresh(): Promise<void> {
  const res = (await browser.runtime.sendMessage({
    type: 'list-snapshots',
  })) as ListResult;
  render(res.snapshots ?? []);
}

async function save(): Promise<void> {
  saveBtn.disabled = true;
  setStatus('Saving…');
  const res = (await browser.runtime.sendMessage({
    type: 'save-current',
    name: nameInput.value.trim() || undefined,
  })) as SaveResult;
  saveBtn.disabled = false;

  if (res.ok && res.snapshot) {
    setStatus(`Saved (${res.snapshot.tier1.fields.length} fields).`, 'ok');
    nameInput.value = '';
    await refresh();
  } else {
    setStatus(res.error || 'Save failed.', 'err');
  }
}

async function restore(id: string): Promise<void> {
  setStatus('Restoring…');
  const res = (await browser.runtime.sendMessage({
    type: 'restore-snapshot',
    id,
  })) as RestoreResult;
  if (res.ok && res.report) {
    const { applied, missing } = res.report;
    setStatus(
      missing > 0
        ? `Restored ${applied} fields, ${missing} not found yet.`
        : `Restored ${applied} fields.`,
      'ok',
    );
  } else {
    setStatus(res.error || 'Restore failed.', 'err');
  }
}

async function remove(id: string): Promise<void> {
  const res = (await browser.runtime.sendMessage({
    type: 'delete-snapshot',
    id,
  })) as SimpleResult;
  if (res.ok) await refresh();
}

saveBtn.addEventListener('click', save);
nameInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') save();
});
$('open-dashboard').addEventListener('click', (e) => {
  e.preventDefault();
  browser.runtime.openOptionsPage?.();
});

refresh();
