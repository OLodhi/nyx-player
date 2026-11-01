/**
 * LiveTvPage - Page principale de l'onglet TV
 *
 * Affiche la grille de chaînes filtrées par catégorie.
 * La sidebar catégories est gérée séparément (TvCategoriesSidebar dans App.tsx).
 */

import React, { useMemo, useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { IptvCategory, IptvStream } from '../types/iptv';
import type { LiveTvViewMode } from '../types/navigation';
import ChannelGrid from '../components/Tv/ChannelGrid';
import { GuideTvGrid } from '../components/Tv/GuideTvGrid';
import { useGuideTvData } from '../hooks/useGuideTvData';
import { usePlayer } from '../contexts/PlayerContext';
import { launchedChannelIn, rememberLaunchedChannel } from '../utils/liveTvLastChannel';
import { isTv } from '../utils/platform';
import { refocusWhenLost } from '../utils/refocus';
import { getFavorites } from '../services/liveTvBookmarksService';
import { LIVE_TV_BOOKMARKS_EVENT } from '../services/eventConstants';
import { useDevOverrides } from '../contexts/DevOverrideContext';
import NyxButton from '../components/Common/NyxButton';
import './LiveTvPage.css';

// ============================================================================
// COMPONENT PROPS
// ============================================================================
interface LiveTvPageProps {
    categories: IptvCategory[];
    streams: IptvStream[];
    selectedCategory: string;
    viewMode: LiveTvViewMode;
    onBrowseCategory?: () => void; // Callback pour naviguer vers une autre catégorie depuis l'état vide
}

// ============================================================================
// COMPONENT
// ============================================================================
const LiveTvPage: React.FC<LiveTvPageProps> = ({
    categories,
    streams,
    selectedCategory,
    viewMode,
    onBrowseCategory,
}) => {
    const { t } = useTranslation('tv');
    const { play, currentlyPlaying } = usePlayer();
    const { overrides, setActivePage } = useDevOverrides();
    const tvOverrides = overrides.liveTvPage;

    // Register active page for DevPanel
    useEffect(() => {
        setActivePage('LiveTvPage');
    }, [setActivePage]);

    // Favoris relus depuis la base (synchro avec un autre appareil, chargement) : la liste Favoris suit.
    // Un favori retiré ici reste affiché jusqu'au changement de catégorie : la sélection ne saute pas.
    const [favoritesReloads, setFavoritesReloads] = useState(0);
    useEffect(() => {
        const handleUpdate = (event: Event) => {
            const type = (event as CustomEvent<{ type?: string }>).detail?.type;
            if (type === 'reload' || type === 'init' || type === 'reset') setFavoritesReloads(v => v + 1);
        };
        window.addEventListener(LIVE_TV_BOOKMARKS_EVENT, handleUpdate);
        return () => window.removeEventListener(LIVE_TV_BOOKMARKS_EVENT, handleUpdate);
    }, []);

    // Retour du lecteur (TV) : la page est restée montée mais cachée, le focus est tombé sur le fond.
    // Le compteur prévient la grille, qui retrouve la chaîne lancée ; le guide retrouve sa case.
    const [returns, setReturns] = useState(0);
    const wasPlaying = useRef(false);
    const playing = !!currentlyPlaying;
    useEffect(() => {
        if (wasPlaying.current && !playing && isTv()) setReturns((v) => v + 1);
        wasPlaying.current = playing;
    }, [playing]);

    // ========================================================================
    // MEMOIZED VALUES
    // ========================================================================

    // Chaînes filtrées selon la catégorie sélectionnée
    const filteredChannels = useMemo(() => {
        // DevPanel: forcer vide
        if (tvOverrides.forceEmpty) return [];

        if (selectedCategory === 'favorites') {
            const favoriteIds = getFavorites();
            return streams.filter((s) => favoriteIds.has(Number(s.stream_id)));
        }
        // Catégorie normale
        return streams.filter((s) => String(s.category_id) === selectedCategory);
    // favoritesReloads : getFavorites() lit un cache hors React, relu après chaque synchro
    // eslint-disable-next-line react-hooks/exhaustive-deps -- favoritesReloads relance le calcul : getFavorites() lit un cache hors React
    }, [selectedCategory, streams, tvOverrides.forceEmpty, favoritesReloads]);

    // Nom de la catégorie courante
    const categoryName = useMemo(() => {
        if (selectedCategory === 'favorites') return t('favorites_title');
        const cat = categories.find(c => c.category_id === selectedCategory);
        return cat?.category_name || t('channels_default');
    }, [selectedCategory, categories, t]);

    // ========================================================================
    // CALLBACKS
    // ========================================================================

    const handleChannelClick = useCallback(
        (channel: IptvStream) => {
            rememberLaunchedChannel(selectedCategory, Number(channel.stream_id));
            void play(channel);
        },
        [play, selectedCategory]
    );

    // ========================================================================
    // DERIVED STATE
    // ========================================================================
    const showEmptyState = filteredChannels.length === 0 && !tvOverrides.forceLoading && !tvOverrides.forceError;
    const showError = tvOverrides.forceError;
    const showLoading = tvOverrides.forceLoading;

    // ========================================================================
    // RENDER
    // ========================================================================
    return (
        // data-view et data-category : vue et catégorie affichées, lues par le banc sur le bureau, la TV
        // et le téléphone (où les catégories sont dans un volet fermé)
        <div className="live-tv-page" data-testid="live-page" data-view={viewMode} data-category={selectedCategory}>
            {/* Header avec nom de catégorie */}
            <header className="live-tv-page__header">
                <h1 className="live-tv-page__title">{categoryName}</h1>
                <span className="live-tv-page__count">{t('channels_count', { count: filteredChannels.length })}</span>
            </header>

            {/* Contenu principal */}
            <main className={`live-tv-page__content scrollbar-thin${viewMode === 'epg' ? ' live-tv-page__content--guide' : ''}`}>
                {showLoading ? (
                    <div className="live-tv-loading">
                        <div className="live-tv-loading__spinner" />
                        <p className="live-tv-loading__text">{t('loading_channels', 'Chargement des chaînes…')}</p>
                    </div>
                ) : showError ? (
                    <div className="live-tv-error">
                        <span className="live-tv-error__icon">⚠</span>
                        <p className="live-tv-error__message">{tvOverrides.forceError}</p>
                    </div>
                ) : viewMode === 'epg' ? (
                    <GuideTvContent channels={filteredChannels} onChannelClick={handleChannelClick} returns={returns} />
                ) : showEmptyState ? (
                    <div className="live-tv-empty">
                        <div className="live-tv-empty__icon">
                            {selectedCategory === 'favorites' ? '❤️' : '📺'}
                        </div>
                        <h3 className="live-tv-empty__title">
                            {selectedCategory === 'favorites'
                                ? t('empty_favorites_title')
                                : t('empty_category_title')}
                        </h3>
                        <p className="live-tv-empty__description">
                            {selectedCategory === 'favorites'
                                ? t('empty_favorites_desc')
                                : t('empty_category_desc')}
                        </p>
                        {selectedCategory === 'favorites' && onBrowseCategory && (
                            <NyxButton
                                variant="primary"
                                size="sm"
                                color="red"
                                data-testid="live-favorites-browse"
                                onClick={onBrowseCategory}
                            >
                                {t('browse_channels')}
                            </NyxButton>
                        )}
                    </div>
                ) : (
                    <ChannelGrid
                        channels={filteredChannels}
                        onChannelClick={handleChannelClick}
                        restoreStreamId={launchedChannelIn(selectedCategory)}
                        returns={returns}
                    />
                )}
            </main>
        </div>
    );
};

// ============================================================================
// GUIDE TV CONTENT — Sous-composant pour le mode EPG
// Permet d'appeler useGuideTvData uniquement quand viewMode === 'epg'
// (le hook ne tourne pas en mode grid)
// ============================================================================

interface GuideTvContentProps {
    channels: IptvStream[];
    onChannelClick: (channel: IptvStream) => void;
    /** Nombre de retours du lecteur : à chaque retour, le focus revient sur la case du guide. */
    returns: number;
}

const GuideTvContent: React.FC<GuideTvContentProps> = ({ channels, onChannelClick, returns }) => {
    useEffect(() => {
        if (returns === 0) return undefined;
        return refocusWhenLost('[data-guide-row][tabindex="0"]');
    }, [returns]);
    const { programs, originTs, totalMinutes, isLoading, error, loadedDays, loadDay } = useGuideTvData(channels);

    return (
        <GuideTvGrid
            channels={channels}
            onChannelClick={onChannelClick}
            programs={programs}
            originTs={originTs}
            totalMinutes={totalMinutes}
            isLoading={isLoading}
            error={error}
            loadDay={loadDay}
            loadedDays={loadedDays}
        />
    );
};

export default LiveTvPage;
