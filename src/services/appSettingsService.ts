/**
 * App Settings Service — Settings JSON côté Rust (pre-boot)
 *
 * Contrairement à preferencesService (SQLite), ces settings sont lus
 * par Rust AVANT l'init de WebView2. Ils contrôlent des paramètres
 * qui ne peuvent pas être changés à chaud (ex: accélération matérielle).
 */

import { invoke } from '@tauri-apps/api/core';

// ============================================================================
// GENERIC GET / SET
// ============================================================================

export async function getAppSetting(key: string): Promise<string> {
  return invoke<string>('get_app_setting', { key });
}

export async function setAppSetting(key: string, value: string): Promise<void> {
  await invoke('set_app_setting', { key, value });
}

// ============================================================================
// TYPED HELPERS
// ============================================================================

export async function isHardwareAccelerationEnabled(): Promise<boolean> {
  const val = await getAppSetting('hardware_acceleration');
  return val !== 'false';
}

export async function setHardwareAcceleration(enabled: boolean): Promise<void> {
  await setAppSetting('hardware_acceleration', String(enabled));
}
