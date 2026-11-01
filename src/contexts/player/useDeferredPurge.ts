import { useCallback, useEffect, useRef } from 'react';
import { purgeInPlayerMode } from '../../services/memoryService';

/** Délai laissé à visibility:hidden avant la purge mémoire qui suit un lancement */
const PURGE_DELAY_MS = 500;

/**
 * Purge mémoire programmée après un lancement : annulée par l'arrêt ou le lancement suivant,
 * et au démontage du lecteur.
 */
export function useDeferredPurge(): { schedulePurge: () => void; cancelPendingPurge: () => void } {
    const purgeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const cancelPendingPurge = useCallback(() => {
        if (purgeTimerRef.current === null) return;
        clearTimeout(purgeTimerRef.current);
        purgeTimerRef.current = null;
    }, []);
    useEffect(() => cancelPendingPurge, [cancelPendingPurge]);

    // Purge active différée : attend que visibility:hidden prenne effet
    // pour que Chromium ait réellement du contenu à libérer (grille TV, DOM page)
    const schedulePurge = useCallback(() => {
        purgeTimerRef.current = setTimeout(() => {
            purgeTimerRef.current = null;
            void purgeInPlayerMode();
        }, PURGE_DELAY_MS);
    }, []);

    return { schedulePurge, cancelPendingPurge };
}
