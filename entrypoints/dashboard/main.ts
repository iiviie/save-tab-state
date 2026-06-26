// Dashboard (options page): full list of snapshots with restore/delete.
// Workspaces UI lands in a later phase (PRD §7.3).

import type {
  ListResult,
  RestoreResult,
  SimpleResult,
} from '@/src/lib/messaging';
import type { Snapshot } from '@/src/lib/types';

const $ = <T extends HTMLElement>(id: string): T =>
  document.getElementById(id) as T;

const listEl = $<HTMLUListElement>('snapshots');
const emptyEl = $<HTMLParagraphElement>('empty');
const countEl = $<HTMLSpanElement>('count');

function fmtDate(ts: number): string {
  return new Date(ts).toLocaleString();
}

function render(snapshots: Snapshot[]): void {
  listEl.innerHTML = '';
  emptyEl.hidden = snapshots.length > 0;
  countEl.textContent = snapshots.length
    ? `${snapshots.length} saved`
    : '';

  for (const snap of snapshots) {
    const li = document.createElement('li');

    const info = document.createElement('div');
    info.className = 'info';

    const title = document.createElement('a');
    title.className = 'title';
    title.textContent = snap.name || snap.title || snap.url;
    title.href = snap.url;
    title.target = '_blank';
    title.rel = 'noreferrer';

    const meta = document.createElement('span');
    meta.className = 'meta';
    const host = new URL(snap.url).hostname;
    meta.textContent = `${host} · ${snap.tier1.fields.length} fields · ${snap.tier1.scroll.length} scroll · ${fmtDate(snap.createdAt)}`;

    info.append(title, meta);

    const actions = document.createElement('div');
    actions.className = 'actions';
    const restoreBtn = document.createElement('button');
    restoreBtn.className = 'primary';
    restoreBtn.textContent = 'Restore';
    restoreBtn.onclick = () => restore(snap.id, restoreBtn);
    const delBtn = document.createElement('button');
    delBtn.textContent = 'Delete';
    delBtn.className = 'del';
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

async function restore(id: string, btn: HTMLButtonElement): Promise<void> {
  const original = btn.textContent;
  btn.disabled = true;
  btn.textContent = 'Restoring…';
  const res = (await browser.runtime.sendMessage({
    type: 'restore-snapshot',
    id,
  })) as RestoreResult;
  btn.disabled = false;
  btn.textContent = original;
  if (!res.ok) alert(res.error || 'Restore failed.');
}

async function remove(id: string): Promise<void> {
  const res = (await browser.runtime.sendMessage({
    type: 'delete-snapshot',
    id,
  })) as SimpleResult;
  if (res.ok) await refresh();
}

refresh();
