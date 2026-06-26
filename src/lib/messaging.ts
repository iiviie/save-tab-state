// Typed message protocol for StateKeep.
//
//   popup/dashboard  ->  background : user commands (save, restore, list...)
//   background        ->  content   : capture / apply Tier-1 state in the page
//
// Each message has a `type` discriminant and a matching response shape.

import type { Tier1State, Snapshot, Workspace } from './types';
import type { RestoreReport } from './restore';

// --- content-script messages (background -> content) ---

export interface CaptureRequest {
  type: 'capture-tier1';
}
export interface CaptureResponse {
  ok: true;
  state: Tier1State;
  title: string;
  url: string;
}

export interface ApplyRequest {
  type: 'apply-tier1';
  state: Tier1State;
}
export interface ApplyResponse {
  ok: true;
  report: RestoreReport;
}

export type ContentMessage = CaptureRequest | ApplyRequest;

// --- background commands (popup/dashboard -> background) ---

export interface SaveCmd {
  type: 'save-current';
  /** Optional user-given name for the snapshot. */
  name?: string;
}
export interface RestoreCmd {
  type: 'restore-snapshot';
  id: string;
}
export interface ListSnapshotsCmd {
  type: 'list-snapshots';
}
export interface DeleteSnapshotCmd {
  type: 'delete-snapshot';
  id: string;
}

/** Lightweight view of an open browser tab, for the workspace picker. */
export interface TabInfo {
  id: number;
  title: string;
  url: string;
  favIconUrl?: string;
}

export interface ListTabsCmd {
  type: 'list-tabs';
}
export interface SaveWorkspaceCmd {
  type: 'save-workspace';
  name: string;
  /** Tab ids the user chose to include. */
  tabIds: number[];
}
export interface ListWorkspacesCmd {
  type: 'list-workspaces';
}
export interface RestoreWorkspaceCmd {
  type: 'restore-workspace';
  id: string;
}
export interface DeleteWorkspaceCmd {
  type: 'delete-workspace';
  id: string;
}

export type BackgroundCommand =
  | SaveCmd
  | RestoreCmd
  | ListSnapshotsCmd
  | DeleteSnapshotCmd
  | ListTabsCmd
  | SaveWorkspaceCmd
  | ListWorkspacesCmd
  | RestoreWorkspaceCmd
  | DeleteWorkspaceCmd;

export interface SaveResult {
  ok: boolean;
  snapshot?: Snapshot;
  error?: string;
}
export interface RestoreResult {
  ok: boolean;
  report?: RestoreReport;
  error?: string;
}
export interface ListResult {
  ok: boolean;
  snapshots?: Snapshot[];
  error?: string;
}
export interface SimpleResult {
  ok: boolean;
  error?: string;
}

export interface ListTabsResult {
  ok: boolean;
  tabs?: TabInfo[];
  error?: string;
}

/** A workspace plus its resolved snapshots, for display. */
export interface WorkspaceView {
  workspace: Workspace;
  snapshots: Snapshot[];
}
export interface ListWorkspacesResult {
  ok: boolean;
  workspaces?: WorkspaceView[];
  error?: string;
}
export interface SaveWorkspaceResult {
  ok: boolean;
  workspace?: Workspace;
  /** How many tabs were captured vs requested. */
  captured?: number;
  requested?: number;
  error?: string;
}
export interface RestoreWorkspaceResult {
  ok: boolean;
  /** Per-snapshot restore reports, in workspace order. */
  reports?: { snapshotId: string; report?: RestoreReport; error?: string }[];
  error?: string;
}
