// Typed message protocol for StateKeep.
//
//   popup/dashboard  ->  background : user commands (save, restore, list...)
//   background        ->  content   : capture / apply Tier-1 state in the page
//
// Each message has a `type` discriminant and a matching response shape.

import type { Tier1State, Snapshot } from './types';
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

export type BackgroundCommand =
  | SaveCmd
  | RestoreCmd
  | ListSnapshotsCmd
  | DeleteSnapshotCmd;

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
