// The whole surface between the window and the Rust side: nineteen commands and three events.
// Nothing here takes a URL or a command line; the Rust side decides what to run and open.

import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import type { AppState, DisconnectResult, Diagnosis, NodeSettings, PairingEnded, UpdateNotice } from './types';

export interface Ipc {
  appState(): Promise<AppState>;
  acceptConsent(): Promise<void>;
  beginPairing(): Promise<void>;
  cancelPairing(): Promise<void>;
  setSharing(on: boolean): Promise<void>;
  stopOutsideNode(): Promise<void>;
  /** Stop the node and start it again. Only for a node this app started. */
  restartNode(): Promise<void>;
  /** Stop the node and move this computer's settings aside. The key is NOT revoked. */
  disconnect(): Promise<DisconnectResult>;
  /** This computer's node settings, for reading. */
  getNodeSettings(): Promise<NodeSettings>;
  getUpdateNotice(): Promise<UpdateNotice | null>;
  openTokensPage(): Promise<void>;
  openDownloadPage(): Promise<void>;
  /** Ask ProxyHubb's servers now (the engine limits how often it really does). */
  refreshAccount(): Promise<void>;
  /** The node's checks, in plain words. Can take a minute. */
  runDiagnosis(): Promise<Diagnosis>;
  /** Write the support file and open its folder; resolves to where the file is. */
  saveSupportDetails(): Promise<string>;
  openPairingLink(): Promise<void>;
  openDashboard(): Promise<void>;
  getAutostart(): Promise<boolean>;
  setAutostart(on: boolean): Promise<void>;
  onState(callback: (state: AppState) => void): Promise<UnlistenFn>;
  onPairingEnded(callback: (ended: PairingEnded) => void): Promise<UnlistenFn>;
  onUpdate(callback: (notice: UpdateNotice | null) => void): Promise<UnlistenFn>;
}

const tauriIpc: Ipc = {
  appState: () => invoke<AppState>('app_state'),
  acceptConsent: () => invoke<void>('accept_consent'),
  beginPairing: () => invoke<void>('begin_pairing'),
  cancelPairing: () => invoke<void>('cancel_pairing'),
  setSharing: (on) => invoke<void>('set_sharing', { on }),
  stopOutsideNode: () => invoke<void>('stop_outside_node'),
  restartNode: () => invoke<void>('restart_node'),
  disconnect: () => invoke<DisconnectResult>('disconnect_computer'),
  getNodeSettings: () => invoke<NodeSettings>('get_node_settings'),
  getUpdateNotice: () => invoke<UpdateNotice | null>('get_update_notice'),
  openTokensPage: () => invoke<void>('open_tokens_page'),
  openDownloadPage: () => invoke<void>('open_download_page'),
  refreshAccount: () => invoke<void>('refresh_account'),
  runDiagnosis: () => invoke<Diagnosis>('run_diagnosis'),
  saveSupportDetails: () => invoke<string>('save_support_details'),
  openPairingLink: () => invoke<void>('open_pairing_link'),
  openDashboard: () => invoke<void>('open_dashboard'),
  getAutostart: () => invoke<boolean>('get_autostart'),
  setAutostart: (on) => invoke<void>('set_autostart', { on }),
  onState: (callback) => listen<AppState>('app://state', (e) => callback(e.payload)),
  onPairingEnded: (callback) => listen<PairingEnded>('app://pairing-ended', (e) => callback(e.payload)),
  onUpdate: (callback) => listen<UpdateNotice | null>('app://update', (e) => callback(e.payload)),
};

function insideTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

/** The real bridge inside the app. In `npm run dev` in a plain browser, a scripted mock so the
 *  screens can be looked at; the mock is compiled out of production builds. */
export async function loadIpc(): Promise<Ipc> {
  if (insideTauri()) return tauriIpc;
  if (import.meta.env.DEV) {
    const { createMockIpc } = await import('./mock');
    return createMockIpc();
  }
  throw new Error('This page only works inside the ProxyHubb Provider app.');
}
