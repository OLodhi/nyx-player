/**
 * hiddenCategoriesService.ts — Masquage de catégories par type
 *
 * Architecture :
 * - Cache mémoire (Set) pour lectures synchrones O(1)
 * - SQLite pour persistance (async)
 * - Connexion via getDatabase() (singleton dbCore.ts)
 * - Event 'hiddenCategoriesUpdated' pour sync cross-composant
 *
 * Pattern identique à liveTvBookmarksService.ts
 */

import { getDatabase } from './dbCore';
import { HIDDEN_CATEGORIES_EVENT } from './eventConstants';
import { batchSyncHiddenCategoriesToCloud } from './syncService';
import { createLogger } from '../utils/logger';

const log = createLogger('HiddenCategories');

// ============================================================================
// CACHE MÉMOIRE
// ============================================================================

/** Set de clés "categoryId::type" pour lookup O(1) */
let hiddenSet: Set<string> = new Set();

/** Construit la clé composite pour le Set */
function makeKey(categoryId: string, type: string): string {
  return `${categoryId}::${type}`;
}

// ============================================================================
// INIT (appelé au boot via SessionContext.initServices)
// ============================================================================

/**
 * Charge les catégories masquées depuis SQLite dans le cache mémoire.
 * Utilise getDatabase() pour la connexion centralisée.
 *
 * Relu à chaque ouverture de session : la base est celle du compte connecté, et un
 * changement de compte sans relancer l'app ne doit rien laisser du compte précédent.
 */
export async function initHiddenCategories(): Promise<void> {
  try {
    const db = await getDatabase();
    const rows = await db.select<{ category_id: string; type: string }[]>(
      'SELECT category_id, type FROM hidden_categories'
    );
    hiddenSet = new Set(rows.map(r => makeKey(r.category_id, r.type)));
  } catch (error) {
    log.error('Init failed:', error);
    hiddenSet = new Set();
  }

  window.dispatchEvent(new CustomEvent(HIDDEN_CATEGORIES_EVENT, { detail: { type: 'init' } }));
}

// ============================================================================
// API SYNCHRONE (lecture cache)
// ============================================================================

/** Vérifie si une catégorie est masquée — O(1) */
export function isHidden(categoryId: string, type: string): boolean {
  return hiddenSet.has(makeKey(categoryId, type));
}

/** Retourne les category_ids masqués pour un type donné */
export function getHiddenSet(type: string): Set<string> {
  const result = new Set<string>();
  for (const key of hiddenSet) {
    const [catId, catType] = key.split('::');
    if (catType === type) {
      result.add(catId);
    }
  }
  return result;
}

// ============================================================================
// API ASYNC (écriture SQLite + cache)
// ============================================================================

/**
 * Masquer toutes les catégories données pour un type.
 * Remplace l'état actuel pour ce type (supprime les anciennes, insère les nouvelles).
 * Appelé par le bouton "Valider" du CategoryManagerModal.
 */
export async function setAllHidden(type: string, categoryIds: string[]): Promise<void> {
  // 1. Supprimer les anciennes masquées de ce type du cache
  for (const key of [...hiddenSet]) {
    if (key.endsWith(`::${type}`)) {
      hiddenSet.delete(key);
    }
  }

  // 2. Ajouter les nouvelles au cache
  for (const catId of categoryIds) {
    hiddenSet.add(makeKey(catId, type));
  }

  window.dispatchEvent(new CustomEvent(HIDDEN_CATEGORIES_EVENT, { detail: { type: 'batch' } }));

  // 3. Persist to SQLite (transaction-like: delete all for type, then batch insert)
  try {
    const db = await getDatabase();
    await db.execute('DELETE FROM hidden_categories WHERE type = ?', [type]);
    for (const catId of categoryIds) {
      await db.execute(
        'INSERT OR IGNORE INTO hidden_categories (category_id, type) VALUES (?, ?)',
        [catId, type]
      );
    }

    // 4. Sync cloud — batch chunked (upsert-first, delete-after)
    const syncOk = await batchSyncHiddenCategoriesToCloud(type, categoryIds);
    if (!syncOk) {
      log.warn(`Batch sync cloud failed for type=${type}, local state is correct`);
    }
  } catch (error) {
    log.error('setAllHidden failed:', error);
  }
}

// ============================================================================
// RESET / RELOAD
// ============================================================================

/**
 * Vider le cache mémoire des catégories masquées.
 * Appelé après wipeProviderSpecificData pour éviter que le prochain fournisseur hérite des
 * données en mémoire (le compte suivant, lui, repart de sa base : initHiddenCategories la relit).
 */
export function resetHiddenCategories(): void {
  hiddenSet.clear();
  window.dispatchEvent(new CustomEvent(HIDDEN_CATEGORIES_EVENT, { detail: { type: 'reset' } }));
}

/**
 * Recharge les catégories masquées depuis SQLite dans le cache mémoire.
 * Appelé par syncService après un pull cloud pour mettre à jour les getters synchrones.
 */
export async function reloadHiddenCategoriesFromDb(): Promise<void> {
  try {
    const db = await getDatabase();
    const rows = await db.select<{ category_id: string; type: string }[]>(
      'SELECT category_id, type FROM hidden_categories'
    );
    hiddenSet = new Set(rows.map(r => makeKey(r.category_id, r.type)));

    window.dispatchEvent(new CustomEvent(HIDDEN_CATEGORIES_EVENT, { detail: { type: 'reload' } }));
  } catch (error) {
    log.error('reloadFromDb failed:', error);
  }
}
