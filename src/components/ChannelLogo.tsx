/**
 * Composant React pour afficher le logo d'une chaîne TV.
 *
 * Fallback chain:
 * 1. tv-logo GitHub (haute qualité)
 * 2. stream_icon Xtream
 * 3. Placeholder avec initiales
 *
 * Refactored: Utilise useMemo pour l'URL initiale au lieu de useState
 * afin de réagir correctement aux changements de props (virtualisation).
 */

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { getPiconUrl, getPiconUrlSync } from '../services/piconService';
import './ChannelLogo.css';

interface ChannelLogoProps {
    channelName: string;
    xtreamIcon?: string;
    size?: 'small' | 'medium' | 'large' | 'xlarge' | 'xxlarge';
    className?: string;
}

/**
 * Retourne le texte du placeholder pour une chaîne sans logo.
 * Simplifié : affiche toujours "TV" pour un rendu cohérent.
 * 
 * Note: une icône SVG maison était envisagée (ancienne idée, jamais planifiée)
 */
function getPlaceholderText(): string {
    return 'TV';
}

/**
 * Valide qu'une URL d'image est potentiellement valide.
 * Filtre les URLs cassées courantes des providers Xtream pour éviter les 404.
 */
function isValidImageUrl(url: string | null | undefined): url is string {
    if (!url) return false;

    // Doit être une URL absolue
    if (!url.startsWith('http://') && !url.startsWith('https://')) return false;

    // Filtrer les patterns cassés courants des providers Xtream
    const invalidPatterns = [
        '/PICON/',           // Chemin PICON cassé
        '/picon/',           // Variante lowercase
        'undefined',         // URL mal construite
        'null',              // URL mal construite
    ];

    return !invalidPatterns.some(pattern => url.includes(pattern));
}

const ChannelLogo: React.FC<ChannelLogoProps> = ({
    channelName,
    xtreamIcon,
    size = 'medium',
    className = '',
}) => {
    // URL initiale depuis le cache (synchrone, recalculé quand props changent)
    const initialUrl = useMemo(() => {
        const { url } = getPiconUrlSync(channelName, xtreamIcon);
        return url;
    }, [channelName, xtreamIcon]);

    // État: URL résolue du picon (initialisée depuis le cache)
    const [piconUrl, setPiconUrl] = useState<string | null>(initialUrl);

    // État: erreur de chargement d'image
    const [hasError, setHasError] = useState(false);

    // État: chargement en cours
    const [isLoading, setIsLoading] = useState(() => {
        const { isPending } = getPiconUrlSync(channelName, xtreamIcon);
        return isPending;
    });

    // Synchroniser l'état avec initialUrl quand les props changent
    const [syncedUrl, setSyncedUrl] = useState(initialUrl);
    if (syncedUrl !== initialUrl) {
        // Mettre à jour immédiatement depuis le cache, dans le même rendu (pas d'image de l'ancienne chaîne)
        setSyncedUrl(initialUrl);
        setPiconUrl(initialUrl);
        setHasError(false);
    }

    // Résolution async du picon si pas en cache
    useEffect(() => {
        let cancelled = false;

        async function resolvePicon() {
            setIsLoading(true);
            setHasError(false);

            try {
                const url = await getPiconUrl(channelName, xtreamIcon);
                if (!cancelled) {
                    setPiconUrl(url);
                    setIsLoading(false);
                }
            } catch {
                if (!cancelled) {
                    setPiconUrl(xtreamIcon || null);
                    setIsLoading(false);
                }
            }
        }

        // Vérifier si on doit résoudre async
        const { isPending } = getPiconUrlSync(channelName, xtreamIcon);
        if (isPending) {
            void resolvePicon();
        } else {
            // eslint-disable-next-line react-hooks/set-state-in-effect -- picon déjà en cache : fin du chargement sans résolution asynchrone (même effet que la résolution)
            setIsLoading(false);
        }

        return () => {
            cancelled = true;
        };
    }, [channelName, xtreamIcon]);

    // Handler d'erreur de chargement d'image
    const handleImageError = useCallback(() => {
        setHasError(true);
        // Si l'image échoue et qu'on a un fallback Xtream différent, l'essayer
        if (piconUrl !== xtreamIcon && xtreamIcon) {
            setPiconUrl(xtreamIcon);
            setHasError(false);
        }
    }, [piconUrl, xtreamIcon]);

    // Texte du placeholder (memoizé)
    const placeholderText = useMemo(() => getPlaceholderText(), []);

    // Classes CSS
    const containerClasses = useMemo(() =>
        [
            'channel-logo',
            `channel-logo--${size}`,
            isLoading ? 'channel-logo--loading' : '',
            className,
        ]
            .filter(Boolean)
            .join(' '),
        [size, isLoading, className]
    );

    // Rendu: image ou placeholder (filtre les URLs invalides pour éviter 404)
    const showPlaceholder = !isValidImageUrl(piconUrl) || hasError;

    return (
        <div className={containerClasses}>
            {!showPlaceholder ? (
                <img
                    src={piconUrl}
                    alt={channelName}
                    className="channel-logo__image"
                    loading="lazy"
                    draggable={false}
                    onError={handleImageError}
                />
            ) : (
                <div className="channel-logo__placeholder">
                    <span className="channel-logo__initials">{placeholderText}</span>
                </div>
            )}
        </div>
    );
};

export default ChannelLogo;
