// Dashboard (options page): full list of snapshots with restore/delete.
// Workspaces UI lands in a later phase (PRD §7.3).

import type {
  ListResult,
  RestoreResult,
  SimpleResult,
  ListTabsResult,
  ListWorkspacesResult,
  SaveWorkspaceResult,
  RestoreWorkspaceResult,
  WorkspaceView,
  TabInfo,
} from '@/src/lib/messaging';
import type { Snapshot } from '@/src/lib/types';

const $ = <T extends HTMLElement>(id: string): T =>
  document.getElementById(id) as T;

const listEl = $<HTMLUListElement>('snapshots');
const emptyEl = $<HTMLParagraphElement>('empty');
const countEl = $<HTMLSpanElement>('count');

const wsListEl = $<HTMLUListElement>('workspaces');
const wsEmptyEl = $<HTMLParagraphElement>('ws-empty');

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
    const fileCount = snap.tier1.files.reduce((n, g) => n + g.files.length, 0);
    const filePart = fileCount > 0 ? ` · ${fileCount} files` : '';
    const autoPart = snap.auto ? ' · auto' : '';
    meta.textContent = `${host} · ${snap.tier1.fields.length} fields${filePart}${autoPart} · ${snap.tier1.scroll.length} scroll · ${fmtDate(snap.createdAt)}`;

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

// --- Workspaces ---

function renderWorkspaces(views: WorkspaceView[]): void {
  wsListEl.innerHTML = '';
  wsEmptyEl.hidden = views.length > 0;

  for (const view of views) {
    const { workspace, snapshots } = view;
    const li = document.createElement('li');

    const info = document.createElement('div');
    info.className = 'info';
    const title = document.createElement('span');
    title.className = 'title';
    title.textContent = workspace.name;
    const meta = document.createElement('span');
    meta.className = 'meta';
    const hosts = snapshots
      .map((s) => new URL(s.url).hostname)
      .slice(0, 5)
      .join(', ');
    meta.textContent = `${snapshots.length} sites${hosts ? ' · ' + hosts : ''}`;
    info.append(title, meta);

    const actions = document.createElement('div');
    actions.className = 'actions';
    const restoreBtn = document.createElement('button');
    restoreBtn.className = 'primary';
    restoreBtn.textContent = 'Restore all';
    restoreBtn.onclick = () => restoreWorkspace(workspace.id, restoreBtn);
    const delBtn = document.createElement('button');
    delBtn.textContent = 'Delete';
    delBtn.className = 'del';
    delBtn.onclick = () => removeWorkspace(workspace.id);
    actions.append(restoreBtn, delBtn);

    li.append(info, actions);
    wsListEl.append(li);
  }
}

async function restoreWorkspace(id: string, btn: HTMLButtonElement): Promise<void> {
  const original = btn.textContent;
  btn.disabled = true;
  btn.textContent = 'Opening…';
  const res = (await browser.runtime.sendMessage({
    type: 'restore-workspace',
    id,
  })) as RestoreWorkspaceResult;
  btn.disabled = false;
  btn.textContent = original;
  if (!res.ok) {
    alert(res.error || 'Restore failed.');
    return;
  }
  const failed = (res.reports ?? []).filter((r) => r.error).length;
  if (failed > 0) alert(`Restored with ${failed} tab(s) that could not be applied.`);
}

async function removeWorkspace(id: string): Promise<void> {
  const res = (await browser.runtime.sendMessage({
    type: 'delete-workspace',
    id,
  })) as SimpleResult;
  if (res.ok) await refresh();
}

// --- Tab picker modal ---

const picker = $<HTMLDivElement>('picker');
const tabListEl = $<HTMLUListElement>('tab-list');
const wsNameInput = $<HTMLInputElement>('ws-name');
const pickerStatus = $<HTMLSpanElement>('picker-status');

async function openPicker(): Promise<void> {
  wsNameInput.value = '';
  pickerStatus.textContent = '';
  tabListEl.innerHTML = '<li class="muted small">Loading tabs…</li>';
  picker.hidden = false;

  const res = (await browser.runtime.sendMessage({
    type: 'list-tabs',
  })) as ListTabsResult;
  const tabs = res.tabs ?? [];
  tabListEl.innerHTML = '';
  if (tabs.length === 0) {
    tabListEl.innerHTML = '<li class="muted small">No eligible tabs in this window.</li>';
    return;
  }
  for (const tab of tabs) {
    tabListEl.append(tabRow(tab));
  }
}

function tabRow(tab: TabInfo): HTMLLIElement {
  const li = document.createElement('li');
  const label = document.createElement('label');
  const cb = document.createElement('input');
  cb.type = 'checkbox';
  cb.value = String(tab.id);
  cb.checked = true;
  const text = document.createElement('span');
  text.className = 'tab-title';
  text.textContent = tab.title;
  text.title = tab.url;
  label.append(cb, text);
  li.append(label);
  return li;
}

function closePicker(): void {
  picker.hidden = true;
}

async function saveWorkspace(): Promise<void> {
  const checked = Array.from(
    tabListEl.querySelectorAll<HTMLInputElement>('input[type=checkbox]:checked'),
  ).map((cb) => Number(cb.value));

  if (checked.length === 0) {
    pickerStatus.textContent = 'Select at least one tab.';
    return;
  }
  pickerStatus.textContent = `Capturing ${checked.length} tab(s)…`;
  const res = (await browser.runtime.sendMessage({
    type: 'save-workspace',
    name: wsNameInput.value,
    tabIds: checked,
  })) as SaveWorkspaceResult;

  if (res.ok) {
    closePicker();
    await refresh();
  } else {
    pickerStatus.textContent = res.error || 'Could not save workspace.';
  }
}

async function refresh(): Promise<void> {
  const [snapRes, wsRes] = (await Promise.all([
    browser.runtime.sendMessage({ type: 'list-snapshots' }),
    browser.runtime.sendMessage({ type: 'list-workspaces' }),
  ])) as [ListResult, ListWorkspacesResult];
  render(snapRes.snapshots ?? []);
  renderWorkspaces(wsRes.workspaces ?? []);
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

$('new-workspace').addEventListener('click', openPicker);
$('picker-close').addEventListener('click', closePicker);
$('picker-save').addEventListener('click', saveWorkspace);
picker.addEventListener('click', (e) => {
  if (e.target === picker) closePicker();
});

refresh();
