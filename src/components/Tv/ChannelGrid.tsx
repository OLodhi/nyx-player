/**
 * ChannelGrid - Grille de chaînes TV virtualisée
 *
 * Utilise react-window pour ne rendre que les éléments visibles.
 * Gère les favoris via SQLite (liveTvBookmarksService).
 */

import React, { useMemo, useCallback, useRef, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FixedSizeGrid, GridChildComponentProps } from 'react-window';
import type { IptvStream } from '../../types/iptv';
import ChannelCard from './ChannelCard';
import { getFavorites, toggleFavorite } from '../../services/liveTvBookmarksService';
import { LIVE_TV_BOOKMARKS_EVENT } from '../../services/eventConstants';
import { useGridEpg } from '../../hooks/useGridEpg';
import { isEpgEnabled } from '../../services/preferencesService';
import type { EpgNowInfo } from '../../services/epgService';
import { isCompactLayout } from '../../utils/layout';
import { isTv } from '../../utils/platform';
import { fitGridColumns, COMPACT_CARD_BOUNDS, channelGridRightPadding } from '../../utils/gridColumns';
import { formatClock } from '../../utils/timeHelpers';
import { focusIsLost } from '../../utils/refocus';
import './ChannelGrid.css';

// ── EPG time formatter ──────────────────────────────────────────────
function formatTimeRange(startTs: number, stopTs: number): string {
    return `${formatClock(startTs)} - ${formatClock(stopTs)}`;
}

// Grid configuration
// Note: react-window requiert des valeurs numériques (pixels)
// Ces valeurs sont calculées pour un layout optimal avec max ~5 colonnes
const GAP = 24;           // Espace entre les cartes
const OVERSCAN = 2;       // Lignes pré-rendues au-dessus/en-dessous
const MAX_COLUMNS = 5;    // Nombre max de colonnes
const RIGHT_PADDING = 32; // Espace entre les cartes et la scrollbar (droite)

interface ChannelGridProps {
    channels: IptvStream[];
    onChannelClick: (channel: IptvStream) => void;
    showFavorites?: boolean;
    /** Force le nombre max de colonnes (défaut = MAX_COLUMNS). Utilisé par le Channel Switcher (2 colonnes). */
    maxColumns?: number;
    /** Chaîne à retrouver au retour du lecteur (TV) : la dernière lancée dans cette catégorie. */
    restoreStreamId?: number | null;
    /** Compteur des retours du lecteur : chaque incrément rend le focus à `restoreStreamId`. */
    returns?: number;
}

// Types pour les données de la grille
interface GridItemData {
    channels: IptvStream[];
    columnCount: number;
    favorites: Set<number>;
    onChannelClick: (channel: IptvStream) => void;
    onToggleFavorite: (e: React.MouseEvent | undefined, channelId: number) => void;
    showFavorites: boolean;
    gap?: number;
    epgMap: Map<string, EpgNowInfo>;
}

// Composant de cellule pour la grille virtualisée
const GridCell: React.FC<GridChildComponentProps<GridItemData>> = ({
    columnIndex,
    rowIndex,
    style,
    data,
}) => {
    const { channels, columnCount, favorites, onChannelClick, onToggleFavorite, showFavorites, epgMap } = data;
    const index = rowIndex * columnCount + columnIndex;

    // Cellule vide si index hors limites
    if (index >= channels.length) {
        return <div style={style} />;
    }

    const channel = channels[index];
    const channelId = Number(channel.stream_id);
    const isFavorite = favorites.has(channelId);

    // EPG lookup
    const targetEpgId = channel.matched_epg_id || channel.epg_channel_id;
    const epgInfo = targetEpgId ? epgMap.get(targetEpgId) : undefined;

    // Style du wrapper: la cellule fait la taille complète, la carte est à l'intérieur avec marge
    const gap = data.gap ?? GAP;
    const cellStyle: React.CSSProperties = {
        ...style,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: gap / 2,
        boxSizing: 'border-box',
    };

    return (
        <div style={cellStyle} data-stream-id={channelId}>
            <ChannelCard
                channelName={channel.name}
                streamIcon={channel.stream_icon}
                onClick={() => onChannelClick(channel)}
                isFavorite={showFavorites ? isFavorite : undefined}
                onToggleFavorite={
                    showFavorites
                        ? (e) => onToggleFavorite(e, channelId)
                        : undefined
                }
                epgTitle={epgInfo?.title}
                epgTimeRange={epgInfo ? formatTimeRange(epgInfo.startTs, epgInfo.stopTs) : undefined}
                epgProgress={epgInfo?.progress}
                debugInfo={{
                    name: channel.name,
                    m3uId: channel.epg_channel_id,
                    matchedEpgId: channel.matched_epg_id,
                    matchMethod: channel.match_method,
                    epgName: epgInfo?.title, // Approximatif
                }}
            />
        </div>
    );
};

const ChannelGrid: React.FC<ChannelGridProps> = ({
    channels,
    onChannelClick,
    showFavorites = true,
    maxColumns,
    restoreStreamId = null,
    returns = 0,
}) => {
    const { t } = useTranslation('tv');

    // EPG integration
    const epgEnabled = isEpgEnabled();
    const epgMap = useGridEpg(channels, epgEnabled);
    // Référence au container pour mesurer la taille
    const containerRef = useRef<HTMLDivElement>(null);
    const gridRef = useRef<FixedSizeGrid>(null);
    const [containerSize, setContainerSize] = useState({ width: 0, height: 0 });

    // État local pour forcer le re-render quand les favoris changent
    const [favoritesVersion, setFavoritesVersion] = React.useState(0);

    // Mesurer la taille du container
    useEffect(() => {
        const updateSize = () => {
            if (containerRef.current) {
                setContainerSize({
                    width: containerRef.current.offsetWidth,
                    height: containerRef.current.offsetHeight,
                });
            }
        };

        updateSize();
        window.addEventListener('resize', updateSize);
        return () => window.removeEventListener('resize', updateSize);
    }, []);

    // Écouter les changements de favoris (cross-composant)
    useEffect(() => {
        const handleUpdate = () => setFavoritesVersion(v => v + 1);
        window.addEventListener(LIVE_TV_BOOKMARKS_EVENT, handleUpdate);
        return () => window.removeEventListener(LIVE_TV_BOOKMARKS_EVENT, handleUpdate);
    }, []);

    // Favoris actuels (lecture cache synchrone)
    const favorites = useMemo(() => {
        void favoritesVersion; // Déclenche re-calcul quand version change
        return getFavorites();
    }, [favoritesVersion]);

    // Toggle favori via service SQLite
    const handleToggleFavorite = useCallback(
        (e: React.MouseEvent | undefined, channelId: number) => {
            e?.stopPropagation(); // Empêcher le clic sur la carte (absent : appui long à la télécommande)
            void toggleFavorite(channelId); // fire-and-forget async
            setFavoritesVersion((v) => v + 1); // Optimistic UI update
        },
        []
    );

    // Mode compact : gaps réduits quand maxColumns est petit (Channel Switcher) ou sur téléphone
    const phone = isCompactLayout();
    const effectiveGap = (maxColumns && maxColumns <= 2) || phone ? 12 : GAP;
    const effectiveRightPadding = channelGridRightPadding({ maxColumns, phone, tv: isTv(), defaultPadding: RIGHT_PADDING });
    const effectiveMaxColumns = maxColumns ?? MAX_COLUMNS;

    // Calcul dynamique de la grille (Responsive Stretch)
    const { columnCount, cardWidth, rowHeight } = useMemo(() => {
        if (containerSize.width === 0) {
            return { columnCount: effectiveMaxColumns, cardWidth: 280, rowHeight: 280 };
        }

        // Largeur utilisable pour les cartes (Container - Espace Droite)
        const usableWidth = containerSize.width - effectiveRightPadding;

        // 1. Déterminer le nombre de colonnes idéal
        // En mode compact (maxColumns fourni : Channel Switcher), minimum réduit à 80
        // pour permettre des cartes plus petites dans un conteneur étroit.
        // Téléphone : cartes encadrées entre ≈ 92 et 150 points, au lieu d'un minimum de 100
        // qui ne laissait que 2 colonnes sur un écran de 360 points.
        const bounds = maxColumns
            ? { minCard: 80, maxColumns: effectiveMaxColumns }
            : phone
                ? { minCard: COMPACT_CARD_BOUNDS.min, maxCard: COMPACT_CARD_BOUNDS.max, maxColumns: effectiveMaxColumns }
                : { minCard: 220, maxColumns: effectiveMaxColumns };
        const cols = fitGridColumns(usableWidth, effectiveGap, bounds);

        // 2. Calculer la largeur exacte pour remplir l'espace utilisable
        const slotWidth = Math.floor(usableWidth / cols);
        const dynamicCardWidth = slotWidth - effectiveGap;

        // 3. Hauteur proportionnelle (Ratio 1:1 + espace EPG si actif)
        const epgExtraHeight = epgEnabled ? 60 : 0;
        const dynamicRowHeight = dynamicCardWidth + epgExtraHeight;

        return {
            columnCount: cols,
            cardWidth: dynamicCardWidth,
            rowHeight: dynamicRowHeight
        };
    }, [containerSize.width, effectiveMaxColumns, effectiveGap, effectiveRightPadding, maxColumns, epgEnabled, phone]);


    // Nombre de lignes
    const rowCount = useMemo(() => {
        return Math.ceil(channels.length / columnCount);
    }, [channels.length, columnCount]);

    // Retour du lecteur : la page était cachée, le focus est tombé sur le fond. On ramène la grille sur la
    // chaîne lancée (même si sa carte n'est plus dessinée) puis on lui rend le focus.
    const seenReturns = useRef(returns);
    useEffect(() => {
        // Seul un nouveau retour agit : un montage tardif de la grille (guide vers grille) ne défile pas
        if (returns === seenReturns.current) return undefined;
        seenReturns.current = returns;
        if (restoreStreamId === null) return undefined;
        const index = channels.findIndex((c) => Number(c.stream_id) === restoreStreamId);
        if (index < 0) return undefined;
        gridRef.current?.scrollToItem({
            rowIndex: Math.floor(index / columnCount),
            columnIndex: index % columnCount,
            align: 'smart',
        });
        let frame = 0;
        let raf = 0;
        const attempt = () => {
            if (!focusIsLost()) return;
            const card = containerRef.current?.querySelector<HTMLElement>(`[data-stream-id="${restoreStreamId}"] .channel-card`);
            card?.focus({ preventScroll: true });
            frame += 1;
            if (document.activeElement !== card && frame < 12) raf = requestAnimationFrame(attempt);
        };
        raf = requestAnimationFrame(attempt);
        return () => cancelAnimationFrame(raf);
        // Seul un nouveau retour déclenche : la liste ou les colonnes qui changent ne volent pas le focus
        // eslint-disable-next-line react-hooks/exhaustive-deps -- seul un nouveau retour du lecteur relance la recherche de la carte
    }, [returns]);

    // Données passées aux cellules
    const itemData: GridItemData = useMemo(() => ({
        channels,
        columnCount,
        favorites,
        onChannelClick,
        onToggleFavorite: handleToggleFavorite,
        showFavorites,
        gap: effectiveGap,
        epgMap,
    }), [channels, columnCount, favorites, onChannelClick, handleToggleFavorite, showFavorites, effectiveGap, epgMap]);

    // Pas de chaînes
    if (channels.length === 0) {
        return (
            <div className="channel-grid__empty">
                <span className="channel-grid__empty-icon">📺</span>
                <p>{t('no_channels_category')}</p>
            </div>
        );
    }

    return (
        <div
            ref={containerRef}
            className="channel-grid"
            style={{
                display: 'flex',
                justifyContent: 'flex-start', // Alignement début pour le stretch
                alignItems: 'flex-start',
                width: '100%',
                height: '100%' // Prend toute la hauteur
            }}
        >
            {containerSize.width > 0 && containerSize.height > 0 && (
                <FixedSizeGrid
                    ref={gridRef}
                    className="scrollbar-thin"
                    columnCount={columnCount}
                    columnWidth={cardWidth + effectiveGap}
                    height={containerSize.height}
                    rowCount={rowCount}
                    rowHeight={rowHeight + effectiveGap}
                    width={containerSize.width} // Scrollbar colle au bord, l'espace est entre les cartes
                    itemData={itemData}
                    overscanRowCount={OVERSCAN}
                    overscanColumnCount={1}
                >
                    {GridCell}
                </FixedSizeGrid>
            )}
        </div>
    );
};

export default ChannelGrid;
