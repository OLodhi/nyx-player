/**
 * Relance de l'app après une remise à zéro, une suppression de compte ou un réglage.
 *
 * Ordinateur : vraie relance du programme (tauri-plugin-process).
 *
 * Android : la relance de Tauri ferme le processus par `exit()` pendant que la WebView et le lecteur
 * tournent encore ; Android arrête alors l'app en plein vol (« pthread_mutex_lock called on a
 * destroyed mutex », SIGABRT), et les dernières écritures du localStorage sont perdues. Après une
 * suppression de compte, la marque de nettoyage restait donc sur l'appareil : chaque lancement
 * refaisait le nettoyage, relançait et replantait, l'app ne s'ouvrait plus. La page est rechargée à
 * la place : le schéma de la base est recréé à chaque ouverture (dbCore.ts), rien n'impose un
 * nouveau processus.
 *
 * iOS : la relance de Tauri n'y est pas prise en charge ; la page est rechargée, comme sur Android.
 */

import { relaunch } from '@tauri-apps/plugin-process';
import { usesNyxPlugin } from '../utils/platform';

export async function restartApp(): Promise<void> {
  if (usesNyxPlugin()) {
    window.location.reload();
    return;
  }
  await relaunch();
}
