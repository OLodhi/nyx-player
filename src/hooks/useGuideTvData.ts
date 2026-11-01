/**
 * useGuideTvData — Hook React pour le chargement des données EPG du Guide TV.
 *
 * Responsabilités :
 * - Charger les programmes du jour courant au montage
 * - Lazy-load des jours adjacents (via `loadDay`)
 * - Merge incrémental dans la Map (append, pas de remplacement)
 * - Reset complet au changement de catégorie (channels change de référence)
 * - Écoute `EPG_UPDATED_EVENT` → reset + recharge jour courant
 * - Logging dev via `devLog('epg', ...)`
 *
 * @param channels — Liste des chaînes IptvStream affichées (catégorie courante)
 * @returns UseGuideTvDataReturn — programmes, originTs, totalMinutes, loading, error, loadedDays, loadDay
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import type { IptvStream } from '../types/iptv';
import type { EpgProgram } from '../services/epgService';
import { getDayPrograms } from '../services/epgService';
import { EPG_UPDATED_EVENT } from '../services/eventConstants';
import { collectEpgIds, getDayMidnight } from '../utils/epgHelpers';
import { devLog } from '../utils/devLog';
import { createLogger } from '../utils/logger';

const log = createLogger('GuideTv');

// ============================================================================
// TYPES
// ============================================================================

/** Valeur de retour du hook useGuideTvData */
export interface UseGuideTvDataReturn {
  /** Map channelId → programmes triés par startTs ASC */
  programs: Map<string, EpgProgram[]>;
  /** Minuit UTC du jour courant (ancre fixe pour positionnement CSS) */
  originTs: number;
  /** Largeur totale de la timeline en minutes (dépend des jours chargés) */
  totalMinutes: number;
  /** Chargement en cours */
  isLoading: boolean;
  /** Message d'erreur ou null */
  error: string | null;
  /** Set des jours déjà chargés (dayMidnightTs) */
  loadedDays: Set<number>;
  /** Charge un jour additionnel (lazy-load au scroll) */
  loadDay: (dayMidnightTs: number) => Promise<void>;
}

/** Identité d'un programme d'une chaîne (le même programme renvoyé par deux jours) */
const programKey = (p: EpgProgram) => `${p.startTs}-${p.stopTs}-${p.title}`;

/**
 * Ajoute les programmes d'un jour à ceux déjà chargés (sans rien remplacer), triés par startTs.
 * Le jour courant passe aussi par là : un jour supplémentaire arrivé avant lui reste affiché.
 */
function mergeDay(
  prev: Map<string, EpgProgram[]>,
  dayData: Map<string, EpgProgram[]>,
): Map<string, EpgProgram[]> {
  const merged = new Map(prev);
  for (const [channelId, newProgs] of dayData) {
    const existing = merged.get(channelId);
    if (existing) {
      // Un programme à cheval sur minuit est renvoyé par les deux jours : on ne le garde
      // qu'une fois (sinon deux blocs superposés dans le guide)
      const known = new Set(existing.map(programKey));
      const fresh = newProgs.filter(p => !known.has(programKey(p)));
      // Append + re-sort par startTs
      const combined = [...existing, ...fresh];
      combined.sort((a, b) => a.startTs - b.startTs);
      merged.set(channelId, combined);
    } else {
      merged.set(channelId, newProgs);
    }
  }
  return merged;
}

// ============================================================================
// HOOK
// ============================================================================

export function useGuideTvData(channels: IptvStream[]): UseGuideTvDataReturn {
  // ── State ──────────────────────────────────────────────────────────────
  const [programs, setPrograms] = useState<Map<string, EpgProgram[]>>(new Map());
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Ancre fixe au montage : minuit UTC d'aujourd'hui (calculée une seule fois, jamais modifiée)
  const [originTs] = useState(() => getDayMidnight(Date.now() / 1000));

  // Jours déjà chargés (évite les re-fetch)
  const loadedDaysRef = useRef<Set<number>>(new Set());

  // Génération des données : incrémentée à chaque remise à zéro (catégorie, synchro EPG).
  // Un chargement lancé avant une remise à zéro est périmé : sa réponse est ignorée.
  const generationRef = useRef(0);

  // Ref stable pour accéder aux channels sans re-subscribe
  const channelsRef = useRef(channels);
  // eslint-disable-next-line react-hooks/refs -- dernière liste de chaînes, lue seulement par les chargements (gestionnaires, promesses)
  channelsRef.current = channels;

  // ── totalMinutes (calculé depuis loadedDays) ───────────────────────────
  const [totalMinutes, setTotalMinutes] = useState(1440); // 24h par défaut

  /**
   * Recalcule totalMinutes depuis les jours chargés.
   * totalMinutes = (maxDayMidnight + 86400 - originTs) / 60
   */
  const updateTotalMinutes = useCallback(() => {
    const days = loadedDaysRef.current;
    if (days.size === 0) {
      setTotalMinutes(1440);
      return;
    }
    const maxDay = Math.max(...days);
    const minutes = (maxDay + 86400 - originTs) / 60;
    setTotalMinutes(minutes);
  }, [originTs]);

  // ── loadDay — charge un jour et merge dans la Map ──────────────────────
  const loadDay = useCallback(async (dayMidnightTs: number) => {
    // Guard : déjà chargé
    if (loadedDaysRef.current.has(dayMidnightTs)) return;

    const ids = collectEpgIds(channelsRef.current);
    if (ids.length === 0) return;

    // Marquer comme chargé immédiatement (évite les appels concurrents)
    const loadedDays = loadedDaysRef.current;
    const generation = generationRef.current;
    loadedDays.add(dayMidnightTs);

    try {
      const dayData = await getDayPrograms(ids, dayMidnightTs);

      // Catégorie changée (ou synchro) pendant le chargement : ces programmes ne valent plus
      if (generation !== generationRef.current) return;

      devLog('epg', '[GuideTv] Day loaded', {
        day: new Date(dayMidnightTs * 1000).toISOString().slice(0, 10),
        channelCount: dayData.size,
      });

      // Merge : append les programmes du nouveau jour dans la Map existante
      setPrograms(prev => mergeDay(prev, dayData));

      updateTotalMinutes();
    } catch (err) {
      // Rollback : retirer le jour du set où il avait été marqué (pas celui d'une génération suivante)
      loadedDays.delete(dayMidnightTs);
      devLog('epg', '[GuideTv] Failed to load day', { dayMidnightTs, err });
    }
  }, [updateTotalMinutes]);

  // ── Chargement initial + reset au changement de catégorie ──────────────
  useEffect(() => {
    // Reset complet
    // eslint-disable-next-line react-hooks/set-state-in-effect -- remise à zéro puis chargement de la nouvelle catégorie (SQLite, génération)
    setPrograms(new Map());
    setError(null);
    setIsLoading(true);
    loadedDaysRef.current = new Set();
    generationRef.current += 1;
    const generation = generationRef.current;

    devLog('epg', '[GuideTv] Reset: category changed');

    const ids = collectEpgIds(channels);
    if (ids.length === 0) {
      setIsLoading(false);
      setTotalMinutes(1440);
      return;
    }

    const todayMidnight = originTs;
    let cancelled = false;
    // Périmé si la catégorie change (cancelled) ou si une synchro EPG relance le chargement
    const isStale = () => cancelled || generation !== generationRef.current;

    void (async () => {
      try {
        loadedDaysRef.current.add(todayMidnight);
        const dayData = await getDayPrograms(ids, todayMidnight);

        if (isStale()) return;

        devLog('epg', '[GuideTv] Day loaded', {
          day: new Date(todayMidnight * 1000).toISOString().slice(0, 10),
          channelCount: dayData.size,
        });

        // Fusion, pas remplacement : un jour supplémentaire a pu arriver avant
        setPrograms(prev => mergeDay(prev, dayData));
        updateTotalMinutes();
      } catch (err) {
        if (isStale()) return;
        loadedDaysRef.current.delete(todayMidnight);
        log.warn('Day load failed:', err);
        setError(err instanceof Error ? err.message : 'Failed to load EPG data');
      } finally {
        if (!isStale()) setIsLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [channels, originTs, updateTotalMinutes]);

  // ── Écoute EPG_UPDATED_EVENT → reset + recharge jour courant ───────────
  useEffect(() => {
    const handler = () => {
      devLog('epg', '[GuideTv] EPG sync detected, reloading');

      // Reset
      loadedDaysRef.current = new Set();
      generationRef.current += 1;
      const generation = generationRef.current;
      setPrograms(new Map());
      setIsLoading(true);
      setError(null);

      const ids = collectEpgIds(channelsRef.current);
      if (ids.length === 0) {
        setIsLoading(false);
        return;
      }

      const todayMidnight = originTs;
      loadedDaysRef.current.add(todayMidnight);

      getDayPrograms(ids, todayMidnight)
        .then(dayData => {
          if (generation !== generationRef.current) return;
          setPrograms(prev => mergeDay(prev, dayData));
          updateTotalMinutes();
        })
        .catch((err) => {
          if (generation !== generationRef.current) return;
          log.warn('Reload after sync failed:', err);
          loadedDaysRef.current.delete(todayMidnight);
          setError('Failed to reload EPG data after sync');
        })
        .finally(() => {
          if (generation === generationRef.current) setIsLoading(false);
        });
    };

    window.addEventListener(EPG_UPDATED_EVENT, handler);
    return () => window.removeEventListener(EPG_UPDATED_EVENT, handler);
  }, [originTs, updateTotalMinutes]);

  /* eslint-disable react-hooks/refs -- Set des jours chargés, rendu tel quel : la grille ne le lit qu'au défilement, il est remplacé à chaque remise à zéro suivie d'un rendu */
  return {
    programs,
    originTs,
    totalMinutes,
    isLoading,
    error,
    loadedDays: loadedDaysRef.current,
    loadDay,
  };
  /* eslint-enable react-hooks/refs */
}
