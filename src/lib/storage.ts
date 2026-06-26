// Local-first storage for StateKeep, backed by IndexedDB (PRD §8: data stays
// on-device). A thin promise wrapper over IDB — no external dependency.
//
// Object stores:
//   snapshots    (keyPath: id)            — one captured page each
//   workspaces   (keyPath: id)            — named bundles of snapshot ids
//   siteSettings (keyPath: origin)        — per-origin opt-in flags

import type { Snapshot, Workspace, SiteSetting } from './types';

const DB_NAME = 'statekeep';
const DB_VERSION = 1;

const STORE_SNAPSHOTS = 'snapshots';
const STORE_WORKSPACES = 'workspaces';
const STORE_SITES = 'siteSettings';

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_SNAPSHOTS)) {
        const store = db.createObjectStore(STORE_SNAPSHOTS, { keyPath: 'id' });
        store.createIndex('origin', 'origin', { unique: false });
        store.createIndex('createdAt', 'createdAt', { unique: false });
      }
      if (!db.objectStoreNames.contains(STORE_WORKSPACES)) {
        db.createObjectStore(STORE_WORKSPACES, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(STORE_SITES)) {
        db.createObjectStore(STORE_SITES, { keyPath: 'origin' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function tx<T>(
  store: string,
  mode: IDBTransactionMode,
  fn: (s: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const transaction = db.transaction(store, mode);
        const request = fn(transaction.objectStore(store));
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      }),
  );
}

function getAll<T>(store: string): Promise<T[]> {
  return tx<T[]>(store, 'readonly', (s) => s.getAll() as IDBRequest<T[]>);
}

// --- Snapshots ---

export async function putSnapshot(snapshot: Snapshot): Promise<void> {
  await tx(STORE_SNAPSHOTS, 'readwrite', (s) => s.put(snapshot));
}

export function getSnapshot(id: string): Promise<Snapshot | undefined> {
  return tx<Snapshot | undefined>(STORE_SNAPSHOTS, 'readonly', (s) => s.get(id));
}

export function listSnapshots(): Promise<Snapshot[]> {
  return getAll<Snapshot>(STORE_SNAPSHOTS);
}

export async function deleteSnapshot(id: string): Promise<void> {
  await tx(STORE_SNAPSHOTS, 'readwrite', (s) => s.delete(id));
}

// --- Workspaces ---

export async function putWorkspace(workspace: Workspace): Promise<void> {
  await tx(STORE_WORKSPACES, 'readwrite', (s) => s.put(workspace));
}

export function listWorkspaces(): Promise<Workspace[]> {
  return getAll<Workspace>(STORE_WORKSPACES);
}

export async function deleteWorkspace(id: string): Promise<void> {
  await tx(STORE_WORKSPACES, 'readwrite', (s) => s.delete(id));
}

// --- Site settings (opt-in) ---

export function getSiteSetting(origin: string): Promise<SiteSetting | undefined> {
  return tx<SiteSetting | undefined>(STORE_SITES, 'readonly', (s) => s.get(origin));
}

export function listSiteSettings(): Promise<SiteSetting[]> {
  return getAll<SiteSetting>(STORE_SITES);
}

export async function putSiteSetting(setting: SiteSetting): Promise<void> {
  await tx(STORE_SITES, 'readwrite', (s) => s.put(setting));
}
