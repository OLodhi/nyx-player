/**
 * usePlayerEpg — EPG now/next pour l'overlay du player Live TV.
 *
 * Fetch au changement de chaîne + polling 60s.
 * Réutilise epgService.getNowAndNextProgram (DRY).
 *
 * La visibilité du bandeau suit les contrôles player (smartLock.isVisible)
 * + apparaît 5s au changement de chaîne même si les contrôles sont masqués.
 *
 * @param currentChannel — chaîne en cours de lecture
 * @param isLiveTv — true si on est en mode Live TV
 * @param controlsVisible — true si les contrôles player sont affichés
 * @returns { nowProgram, nextProgram, isVisible }
 */

import { useState, useEffect, useLayoutEffect, useRef, useCallback } from 'react';
import type { IptvStream } from '../types/iptv';
import { getNowAndNextProgram } from '../services/epgService';
import type { EpgNowInfo } from '../services/epgService';
import { isEpgEnabled } from '../services/preferencesService';
import { EPG_UPDATED_EVENT } from '../services/eventConstants';

const POLL_INTERVAL_MS = 60_000;
const CHANNEL_CHANGE_SHOW_MS = 5_000;

interface UsePlayerEpgReturn {
  nowProgram: EpgNowInfo | null;
  nextProgram: EpgNowInfo | null;
  isVisible: boolean;
}

export function usePlayerEpg(
  currentChannel: IptvStream | undefined,
  isLiveTv: boolean,
  controlsVisible: boolean
): UsePlayerEpgReturn {
  const [nowProgram, setNowProgram] = useState<EpgNowInfo | null>(null);
  const [nextProgram, setNextProgram] = useState<EpgNowInfo | null>(null);
  const [channelChangeShow, setChannelChangeShow] = useState(false);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Résoudre l'epg_channel_id de la chaîne
  const epgId = currentChannel?.matched_epg_id || currentChannel?.epg_channel_id || '';

  // Chaîne dont le bandeau doit montrer le programme : une réponse arrivée pour une autre (zap
  // rapide, requête lente) est ignorée, sinon on voyait le programme de la chaîne précédente
  const currentEpgIdRef = useRef(epgId);
  // Synchrone au rendu affiché : aucune réponse ne peut passer entre le zap et la mise à jour
  useLayoutEffect(() => { currentEpgIdRef.current = epgId; }, [epgId]);

  // ── Fetch EPG data ──────────────────────────────────────────────────
  const fetchEpg = useCallback(async (channelId: string) => {
    if (!channelId) {
      setNowProgram(null);
      setNextProgram(null);
      return;
    }

    try {
      const { now, next } = await getNowAndNextProgram(channelId);
      if (currentEpgIdRef.current !== channelId) return;
      setNowProgram(now);
      setNextProgram(next);
    } catch {
      if (currentEpgIdRef.current !== channelId) return;
      setNowProgram(null);
      setNextProgram(null);
    }
  }, []);

  // ── Effect 1 : Fetch au changement de chaîne + show temporaire ────
  useEffect(() => {
    if (!isLiveTv || !isEpgEnabled() || !epgId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- pas de guide pour ce flux : programme et bandeau effacés
      setNowProgram(null);
      setNextProgram(null);
      setChannelChangeShow(false);
      return;
    }

    // Nouvelle chaîne : le programme de la précédente disparaît tout de suite, puis fetch immédiat
    setNowProgram(null);
    setNextProgram(null);
    void fetchEpg(epgId);

    // Montrer le bandeau 5s (même si contrôles cachés = zapping)
    setChannelChangeShow(true);
    if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    hideTimerRef.current = setTimeout(() => setChannelChangeShow(false), CHANNEL_CHANGE_SHOW_MS);

    return () => {
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
      // Sans ça, le minuteur annulé laissait le bandeau affiché en permanence
      setChannelChangeShow(false);
    };
  }, [epgId, isLiveTv, fetchEpg]);

  // ── Les contrôles prennent le relais : le bandeau disparaît avec eux ────
  useEffect(() => {
    if (!controlsVisible || !channelChangeShow) return;
    if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- les contrôles prennent le relais : bandeau effacé et son minuteur annulé
    setChannelChangeShow(false);
  }, [controlsVisible, channelChangeShow]);

  // ── Effect 2 : Polling 60s (refresh silencieux) ────────────────────
  useEffect(() => {
    if (!isLiveTv || !isEpgEnabled() || !epgId) return;

    const timer = setInterval(() => {
      void fetchEpg(epgId);
    }, POLL_INTERVAL_MS);

    return () => clearInterval(timer);
  }, [epgId, isLiveTv, fetchEpg]);

  // ── Effect 3 : Écouter EPG_UPDATED_EVENT (après sync) ──────────────
  useEffect(() => {
    if (!isLiveTv || !isEpgEnabled()) return;

    const handler = () => {
      if (epgId) void fetchEpg(epgId);
    };

    window.addEventListener(EPG_UPDATED_EVENT, handler);
    return () => window.removeEventListener(EPG_UPDATED_EVENT, handler);
  }, [isLiveTv, epgId, fetchEpg]);

  // Visible si : contrôles affichés OU changement de chaîne récent (5s)
  const isVisible = (controlsVisible || channelChangeShow) && nowProgram !== null;

  return { nowProgram, nextProgram, isVisible };
}
