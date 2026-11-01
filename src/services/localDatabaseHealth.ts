/**
 * Base locale abîmée. Une base illisible (coupure pendant une écriture,
 * mémoire flash défaillante d'une box) laissait l'utilisateur bloqué sur l'écran du fournisseur :
 * chaque connexion échouait et la réinitialisation n'était que dans les Paramètres, hors d'atteinte.
 *
 * Quand la base n'a pas pu être lue, le Rust la contrôle (`nyx_db_check`, PRAGMA quick_check sur une
 * connexion à part) ; abîmée, l'écran du fournisseur propose de réinitialiser les données de cet
 * appareil. Ma liste, reprises et favoris sont dans le compte Nyx : ils reviennent à la reconnexion.
 */

import { useSyncExternalStore } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { getDatabaseFileName } from './dbCore';
import { createLogger } from '../utils/logger';

const log = createLogger('LocalDatabase');

export type LocalDatabaseHealth = 'ok' | 'corrupt' | 'missing' | 'unreadable';

/** Fichier de la base reconnue abîmée (une base par compte : celle d'un autre compte ne compte pas) */
let damagedFile: string | null = null;
const listeners = new Set<() => void>();

function setDamaged(file: string | null): void {
    if (damagedFile === file) return;
    damagedFile = file;
    for (const listener of listeners) listener();
}

/** Messages de SQLite pour une base abîmée (SQLITE_CORRUPT, SQLITE_NOTADB) */
const DAMAGED_PATTERN = /file is not a database|database disk image is malformed|\(code: (11|26)\)|SQLITE_(CORRUPT|NOTADB)/i;

/** Vrai si l'erreur vient d'une base abîmée */
export function isDatabaseDamagedError(error: unknown): boolean {
    const text = error instanceof Error ? error.message : String(error);
    return DAMAGED_PATTERN.test(text);
}

/**
 * Contrôle la base du compte ouvert et retient le résultat pour l'écran du fournisseur. Lit tout le
 * fichier : à appeler seulement quand la base n'a pas pu être lue. 'unreadable' si le contrôle échoue.
 */
export async function checkLocalDatabase(): Promise<LocalDatabaseHealth> {
    const name = getDatabaseFileName();
    if (!name) return 'unreadable';
    try {
        const health = await invoke<LocalDatabaseHealth>('nyx_db_check', { db: `sqlite:${name}` });
        if (health === 'corrupt') {
            log.error('Base locale abîmée : réinitialisation proposée');
            setDamaged(name);
        } else if (health === 'ok' || health === 'missing') {
            if (damagedFile === name) setDamaged(null);
        }
        return health;
    } catch (err) {
        log.warn('Contrôle de la base impossible :', err);
        return 'unreadable';
    }
}

/** Base du compte ouvert abîmée, d'après le dernier contrôle */
export function isLocalDatabaseDamaged(): boolean {
    return damagedFile !== null && damagedFile === getDatabaseFileName();
}

function subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
}

/** Pour l'écran du fournisseur : vrai quand la base du compte est abîmée */
export function useLocalDatabaseDamaged(): boolean {
    return useSyncExternalStore(subscribe, isLocalDatabaseDamaged);
}
