import React, { useMemo } from 'react';
import VirtualDashboardRow from './VirtualDashboardRow';
import { useTranslation } from 'react-i18next';
import type { PlaybackProgressItem } from '../../services/playbackProgressService';
import type { LightIndexes } from '../../types/lightIndex';
import { buildContinueItems, type ContinueActions } from './continueItems';

interface ContinueWatchingRowProps {
    items: PlaybackProgressItem[];
    lightIndexes: LightIndexes | undefined;
    play: ContinueActions['play'];
    setCurrentSeries: ContinueActions['setCurrentSeries'];
    navigateById: ContinueActions['navigateById'];
    handleWatchlistToggle: ContinueActions['handleWatchlistToggle'];
    /** Carte « Introuvable » (titre plus au catalogue) : ouvre la fenêtre Rechercher / Retirer */
    onUnavailable?: ContinueActions['onUnavailable'];
    gap?: number;
}

/**
 * Rangée « Reprendre » (bureau, téléphone ; sur TV, le rail en fait sa propre rangée) : les reprises en cartes
 * (continueItems.ts), qui lancent la lecture directe.
 */
const ContinueWatchingRow: React.FC<ContinueWatchingRowProps> = ({
    items,
    lightIndexes,
    play,
    setCurrentSeries,
    navigateById,
    handleWatchlistToggle,
    onUnavailable,
    gap,
}) => {
    const { t } = useTranslation('dashboard');
    const { t: tNav } = useTranslation('navigation');

    const mappedItems = useMemo(
        () => buildContinueItems(items, lightIndexes, { play, setCurrentSeries, navigateById, handleWatchlistToggle, onUnavailable }, { unavailable: tNav('unavailable_badge') }),
        [items, lightIndexes, play, setCurrentSeries, navigateById, handleWatchlistToggle, onUnavailable, tNav],
    );

    return (
        <VirtualDashboardRow
            title={t('carousel_continue')}
            items={mappedItems}
            priority
            gap={gap}
        />
    );
};

export default React.memo(ContinueWatchingRow);
