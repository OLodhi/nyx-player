/**
 * syncFetch.ts — Lecture complète d'une table du cloud, par pages
 *
 * Supabase (PostgREST) rend au plus 1000 lignes par requête. Avec le dernier accord
 * (syncBaseline.ts), une réponse tronquée ferait prendre les lignes manquantes pour des retraits :
 * chaque table est donc lue en entier, page par page, dans un ordre stable.
 */

import { supabase } from '../supabaseClient';

const PAGE_SIZE = 1000;

/** `orderBy` : colonnes qui identifient une ligne du compte (ordre stable d'une page à l'autre) */
export async function fetchAllRows<T>(table: string, userId: string, orderBy: string[], label = table): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    let query = supabase.from(table).select('*').eq('user_id', userId);
    for (const column of orderBy) query = query.order(column);
    const { data, error } = await query.range(from, from + PAGE_SIZE - 1);
    if (error) throw new Error(`Supabase fetch ${label}: ${error.message}`);
    const page = (data ?? []) as T[];
    rows.push(...page);
    if (page.length < PAGE_SIZE) return rows;
  }
}
