/**
 * useZapChannel.ts — Chaîne suivante / précédente dans la catégorie en cours (direct).
 *
 * Utilisé par Chaîne + / − à la télécommande et par les commandes média (assistant, casque).
 * La liste boucle : après la dernière chaîne vient la première.
 */

import { useCallback } from 'react';
import { channelsInCategory, type LiveTvData } from './useChannelSwitcher';
import type { IptvStream } from '../types/iptv';

export function useZapChannel(
  liveTvData: LiveTvData | undefined,
  switchChannel: (channel: IptvStream) => unknown,
) {
  return useCallback((delta: number) => {
    if (!liveTvData) return;
    const channels = channelsInCategory(liveTvData, liveTvData.currentCategoryId);
    const index = channels.findIndex((c) => c.stream_id === liveTvData.currentChannel.stream_id);
    if (index < 0 || channels.length < 2) return;
    void switchChannel(channels[(index + delta + channels.length) % channels.length]);
  }, [liveTvData, switchChannel]);
}
