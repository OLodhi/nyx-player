/**
 * progressRelink.ts — Reprises de films qui suivent un film renuméroté par le fournisseur
 *
 * Une reprise est rangée par numéro du fournisseur. Quand un catalogue neuf est lu (connexion,
 * « Actualiser », actualisation automatique), le Rust re-lie les reprises dont le numéro n'existe
 * plus au film de même numéro TMDB (`relink_orphan_progress`), et ne les efface jamais.
 * Une reprise sans remplaçant reste en base ; « Reprendre » l'affiche
 * « Introuvable » (`resumeTarget.ts`). Ce module fait suivre le cloud, qui range aussi les reprises
 * par numéro.
 */

import { getDatabase } from './dbCore';
import { pushPlaybackDeleteToCloud, pushPlaybackUpsertToCloud } from './syncService';

export interface ProgressRelink {
  from: number;
  to: number;
}

/**
 * Envoie au cloud chaque reprise re-liée : retrait à l'ancien numéro, écriture au nouveau. Envois
 * sans attente ; un envoi perdu est rattrapé au passage suivant.
 * @param isStillCurrent faux dès que la session a changé : plus rien ne part au nom d'un autre compte
 */
export async function pushRelinkedProgress(
  relinks: readonly ProgressRelink[],
  isStillCurrent: () => boolean,
): Promise<void> {
  if (relinks.length === 0) return;
  const db = await getDatabase();
  for (const { from, to } of relinks) {
    // Les envois partent au nom du compte connecté à cet instant : jamais après un changement de compte
    if (!isStillCurrent()) return;
    pushPlaybackDeleteToCloud(from);
    const rows = await db.select<{
      tmdb_id: number | null; title: string; poster_url: string | null;
      time_seconds: number; duration_seconds: number; container_extension: string | null; updated_at: number;
    }[]>(
      `SELECT tmdb_id, title, poster_url, time_seconds, duration_seconds, container_extension, updated_at
       FROM playback_progress WHERE stream_id = ? AND content_type = 'movie'`,
      [to]
    );
    const row = rows[0];
    if (!row) continue;
    if (!isStillCurrent()) return;
    pushPlaybackUpsertToCloud(to, 'movie', {
      tmdb_id: row.tmdb_id ?? undefined,
      title: row.title,
      poster_url: row.poster_url,
      time_seconds: row.time_seconds,
      duration_seconds: row.duration_seconds,
      container_extension: row.container_extension,
      updated_at: row.updated_at,
    });
  }
}
