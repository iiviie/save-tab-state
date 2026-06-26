// Popup: quick save of the current page + restore/delete recent snapshots.

import type {
  SaveResult,
  ListResult,
  RestoreResult,
  SimpleResult,
  SiteSettingResult,
} from '@/src/lib/messaging';
import type { Snapshot, SiteSetting } from '@/src/lib/types';

const $ = <T extends HTMLElement>(id: string): T =>
  document.getElementById(id) as T;

const nameInput = $<HTMLInputElement>('name');
const saveBtn = $<HTMLButtonElement>('save');
const statusEl = $<HTMLParagraphElement>('status');
const listEl = $<HTMLUListElement>('snapshots');
const emptyEl = $<HTMLParagraphElement>('empty');
const enabledCb = $<HTMLInputElement>('enabled');
const autosaveCb = $<HTMLInputElement>('autosave');
const autosaveRow = $<HTMLDivElement>('autosave-row');
const hostEl = $<HTMLElement>('host');

let currentOrigin: string | null = null;

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
    const fileCount = snap.tier1.files.reduce((n, g) => n + g.files.length, 0);
    const filePart = fileCount > 0 ? ` · ${fileCount} files` : '';
    const autoPart = snap.auto ? ' · auto' : '';
    meta.textContent = `${host} · ${snap.tier1.fields.length} fields${filePart}${autoPart} · ${relativeTime(snap.createdAt)}`;
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

function applySettingToUi(setting: SiteSetting): void {
  enabledCb.checked = setting.enabled;
  autosaveCb.checked = setting.autoSave;
  autosaveRow.hidden = !setting.enabled;
}

async function loadSiteSetting(): Promise<void> {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  if (!tab?.url || !/^https?:/.test(tab.url)) {
    hostEl.textContent = 'this page';
    enabledCb.disabled = true;
    return;
  }
  currentOrigin = new URL(tab.url).origin;
  hostEl.textContent = new URL(tab.url).hostname;
  const res = (await browser.runtime.sendMessage({
    type: 'get-site-setting',
    origin: currentOrigin,
  })) as SiteSettingResult;
  if (res.setting) applySettingToUi(res.setting);
}

async function saveSiteSetting(): Promise<void> {
  if (!currentOrigin) return;
  const setting: SiteSetting = {
    origin: currentOrigin,
    enabled: enabledCb.checked,
    autoSave: enabledCb.checked && autosaveCb.checked,
  };
  applySettingToUi(setting);
  await browser.runtime.sendMessage({ type: 'set-site-setting', setting });
}

enabledCb.addEventListener('change', saveSiteSetting);
autosaveCb.addEventListener('change', saveSiteSetting);

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
    const {
      applied,
      missing,
      filesRestored,
      filesNeedingManualReattach,
      tier2KeysAdded,
    } = res.report;
    const parts = [`Restored ${applied} fields`];
    if (filesRestored > 0) parts.push(`${filesRestored} files`);
    if (tier2KeysAdded > 0) parts.push(`${tier2KeysAdded} storage keys`);
    if (missing > 0) parts.push(`${missing} fields not found yet`);
    if (filesNeedingManualReattach > 0)
      parts.push(`${filesNeedingManualReattach} files need manual re-attach`);
    setStatus(parts.join(', ') + '.', 'ok');
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

loadSiteSetting();
refresh();
