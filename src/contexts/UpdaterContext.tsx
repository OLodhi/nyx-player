import React, { createContext, useContext, useEffect } from 'react';
import { useAppUpdater, type AppUpdaterState } from '../hooks/useAppUpdater';
import { createLogger } from '../utils/logger';

const log = createLogger('DevTools');

// =============================================================================
// CONTEXT
// =============================================================================

const UpdaterContext = createContext<AppUpdaterState | null>(null);

// =============================================================================
// PROVIDER — mount once in App.tsx
// =============================================================================

// Extend window for dev tools
declare global {
    interface Window {
        __simulateUpdate?: (version?: string) => void;
        __dismissUpdate?: () => void;
    }
}

export const UpdaterProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const updater = useAppUpdater();

    // Outils de test (console) : développement seulement, jamais dans la version publiée
    useEffect(() => {
        if (!import.meta.env.DEV) return;
        window.__simulateUpdate = (version = '99.0.0') => {
            // Force the updater state by dispatching a custom event
            window.dispatchEvent(new CustomEvent('__dev-simulate-update', { detail: { version } }));
            log.info(`🔧 Simulated update v${version} — banner should appear`);
        };
        window.__dismissUpdate = () => {
            updater.dismiss();
            log.info('🔧 Update dismissed');
        };
        return () => {
            delete window.__simulateUpdate;
            delete window.__dismissUpdate;
        };
    }, [updater]);

    return (
        <UpdaterContext.Provider value={updater}>
            {children}
        </UpdaterContext.Provider>
    );
};

// =============================================================================
// HOOK — consume from any component
// =============================================================================

export function useUpdater(): AppUpdaterState {
    const ctx = useContext(UpdaterContext);
    if (!ctx) {
        throw new Error('useUpdater must be used within <UpdaterProvider>');
    }
    return ctx;
}
