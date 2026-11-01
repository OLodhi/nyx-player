/**
 * networkStatus.ts — Type de connexion réseau.
 *
 * Sert à ne pas télécharger l'EPG (≈ 205 Mo) sur des données mobiles limitées.
 * Android : `ConnectivityManager` via le plugin natif. Desktop : connexion considérée
 * comme non limitée (l'app Windows tourne sur une machine fixe).
 */

import { invoke } from '@tauri-apps/api/core';
import { isAndroid } from '../utils/platform';
import { devLog } from '../utils/devLog';

export interface NetworkStatus {
  connected: boolean;
  /** Connexion facturée à la consommation (données mobiles, partage de connexion) */
  metered: boolean;
  type: 'wifi' | 'cellular' | 'ethernet' | 'other' | 'none';
}

const DESKTOP_STATUS: NetworkStatus = { connected: true, metered: false, type: 'other' };

export async function getNetworkStatus(): Promise<NetworkStatus> {
  if (!isAndroid()) return DESKTOP_STATUS;

  try {
    return await invoke<NetworkStatus>('plugin:nyx-android|network_status');
  } catch (e) {
    // En cas d'échec on ne bloque pas l'app : connexion supposée non limitée
    devLog('data', 'Etat reseau indisponible', e);
    return DESKTOP_STATUS;
  }
}
