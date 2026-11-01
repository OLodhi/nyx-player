/**
 * calmMoments.ts — Moments où l'interface peut changer sans gêner (changement d'onglet).
 *
 * Module minuscule, sans dépendance : NavigationContext le prévient à chaque changement d'onglet,
 * juste avant d'afficher le nouvel onglet ; la porte du catalogue (catalogSwapGate.ts) y installe
 * un catalogue neuf, dans le même geste (React affiche ensemble le nouvel onglet et le nouveau
 * catalogue : ni page vide, ni contenu qui bouge sous la sélection).
 */

import { createLogger } from '../utils/logger';

const log = createLogger('CalmMoments');

type Listener = () => void;

const tabChangeListeners = new Set<Listener>();

/** Appelé de façon synchrone par NavigationContext.setActiveTab, avant le changement d'onglet */
export function notifyTabChange(): void {
  for (const listener of [...tabChangeListeners]) {
    try {
      listener();
    } catch (e) {
      log.warn('listener failed:', e);
    }
  }
}

export function onTabChange(listener: Listener): () => void {
  tabChangeListeners.add(listener);
  return () => tabChangeListeners.delete(listener);
}
