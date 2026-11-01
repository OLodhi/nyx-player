/**
 * useGridEpg — Hook React pour fournir les données EPG à la grille de chaînes.
 *
 * Deux mécanismes de refresh :
 * 1. Polling toutes les 60s (les programmes changent)
 * 2. Écoute EPG_UPDATED_EVENT (après une sync EPG)
 *
 * @param channels — Liste des chaînes affichées (IptvStream[])
 * @param enabled — EPG activé (preference user)
 * @returns Map<epg_channel_id, EpgNowInfo>
 */

import { useState, useEffect, useRef } from 'react';
import type { IptvStream } from '../types/iptv';
import { getBatchNowPrograms } from '../services/epgService';
import type { EpgNowInfo } from '../services/epgService';
import { EPG_UPDATED_EVENT } from '../services/eventConstants';
import { collectEpgIds } from '../utils/epgHelpers';

// Intervalle de refresh automatique (programmes changent)
const POLL_INTERVAL_MS = 60_000;

export function useGridEpg(
  channels: IptvStream[],
  enabled: boolean
): Map<string, EpgNowInfo> {
  const [epgMap, setEpgMap] = useState<Map<string, EpgNowInfo>>(new Map());

  // Ref stable pour éviter de re-créer la closure à chaque render
  const channelsRef = useRef(channels);
  // eslint-disable-next-line react-hooks/refs -- dernière liste de chaînes, lue seulement par le sondage et l'écouteur de synchro
  channelsRef.current = channels;

  // ── Batch Query + Polling ──────────────────────────────────────────
  useEffect(() => {
    if (!enabled) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- guide désactivé : programmes vidés (sinon alimentés par requêtes SQLite et sondage)
      setEpgMap(new Map());
      return;
    }

    const ids = collectEpgIds(channels);
    if (ids.length === 0) return;

    // Réponse d'une liste de chaînes précédente (changement rapide de catégorie) : ignorée, sinon
    // elle remplaçait les programmes de la catégorie affichée
    let stale = false;
    const apply = (map: Map<string, EpgNowInfo>) => {
      if (!stale) setEpgMap(map);
    };

    // Requête initiale
    getBatchNowPrograms(ids).then(apply).catch(() => {});

    // Polling
    const timer = setInterval(() => {
      const freshIds = collectEpgIds(channelsRef.current);
      if (freshIds.length > 0) {
        getBatchNowPrograms(freshIds).then(apply).catch(() => {});
      }
    }, POLL_INTERVAL_MS);

    return () => {
      stale = true;
      clearInterval(timer);
    };
  }, [channels, enabled]);

  // ── Écouter EPG_UPDATED_EVENT (après sync) ─────────────────────────
  useEffect(() => {
    if (!enabled) return;

    let stale = false;
    const handler = () => {
      const requested = channelsRef.current;
      const ids = collectEpgIds(requested);
      if (ids.length > 0) {
        getBatchNowPrograms(ids)
          .then((map) => {
            // Liste de chaînes changée entre-temps : sa propre requête fait foi
            if (!stale && channelsRef.current === requested) setEpgMap(map);
          })
          .catch(() => {});
      }
    };
    window.addEventListener(EPG_UPDATED_EVENT, handler);
    return () => {
      stale = true;
      window.removeEventListener(EPG_UPDATED_EVENT, handler);
    };
  }, [enabled]);

  return epgMap;
}
