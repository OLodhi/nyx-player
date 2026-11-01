import { useEffect, useState } from 'react';
import { onMpvConnectionChange } from '../../services/mpvBridge';

/** MPV connecté et prêt : suit les changements de connexion du moteur de lecture. */
export function useMpvConnection(): boolean {
    const [mpvConnected, setMpvConnected] = useState(false);

    // Écouter les changements de connexion MPV
    useEffect(() => {
        const unsubscribe = onMpvConnectionChange((state) => {
            setMpvConnected(state === 'connected');
        });
        return unsubscribe;
    }, []);

    return mpvConnected;
}
