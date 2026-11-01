import type { LightIndexes } from '../types/lightIndex';

export type IptvStatus = 'ok' | 'warning' | 'error';

/**
 * Statut du catalogue pour le voyant de la barre latérale et de Paramètres > Sources.
 * - error : rien du tout (ni chaînes, ni films, ni séries) ;
 * - warning : dernier chargement partiel (une liste en échec ou gardée par un garde-fou) ;
 * - ok : sinon. Un type absent chez le fournisseur (offre « chaînes seulement ») n'est pas un
 *   catalogue incomplet : c'est l'ingestion qui distingue l'absence d'une panne.
 */
export function computeIptvStatus(indexes: LightIndexes | null, lastIngestionPartial: boolean): IptvStatus {
    if (!indexes) return 'ok';
    if (indexes.movies.size === 0 && indexes.series.size === 0 && indexes.live.size === 0) return 'error';
    return lastIngestionPartial ? 'warning' : 'ok';
}
