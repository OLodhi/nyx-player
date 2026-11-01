/**
 * SupabaseAuthContext — Provider global d'authentification Supabase
 *
 * Gère le cycle de vie de la session Supabase :
 * - Écoute les changements d'état auth (login, logout, token refresh)
 * - Fournit user/session/loading à toute l'app
 * - Fonctions signIn, signUp, signOut
 *
 * Doit être le Provider le plus externe dans main.tsx.
 */

import React, { createContext, useContext, useState, useEffect, useCallback, useMemo, useRef } from 'react';
import type { ReactNode } from 'react';
import { authErrorKey, type AuthErrorKey } from '../services/authErrors';
import { supabase } from '../services/supabaseClient';
import { clearSignOutRequested, markSignOutRequested, wasSessionLost } from '../services/authSessionWatch';
import { setCurrentSyncUserId } from '../services/syncService';
import { stopCloudResync } from '../services/sync/syncScheduler';
import { resetPreferencesCache } from '../services/preferencesService';
import { setDatabaseName, resetDatabaseName, closeDatabaseConnection } from '../services/dbCore';
import { setKeyringUser, resetKeyringUser } from '../services/storage';
import { resetLiveTvBookmarksCache } from '../services/liveTvBookmarksService';
import { resetCatalogCaches } from '../services/catalogCaches';
import { stopBackgroundWork } from '../services/backgroundWork';
import { stopSyncForSessionChange } from '../services/epgService';
import { sendHeartbeat } from '../services/heartbeatService';
import { forgetSessionOnDevice } from '../services/authLocalSignOut';
import { scheduleAccountExistenceCheck } from '../services/accountExistenceCheck';
import { forgetAccountDeletionOfOtherAccount } from '../services/accountDeletion';
import type { Session, User } from '@supabase/supabase-js';
import { createLogger } from '../utils/logger';

const log = createLogger('Auth');

/** Revérification du compte pendant que l'app reste ouverte */
const ACCOUNT_RECHECK_INTERVAL_MS = 5 * 60_000;

// ============================================================================
// TYPES
// ============================================================================

interface AuthContextType {
    user: User | null;
    session: Session | null;
    loading: boolean;
    isDbReady: boolean;
    /** Vrai quand Supabase a mis fin à la session sans déconnexion demandée (jeton refusé). */
    sessionExpired: boolean;
    /** `error` : texte brut de Supabase (journaux, délai d'attente) ; `errorKey` : message à afficher (espace `auth`) */
    signIn: (email: string, password: string) => Promise<{ error: string | null; errorKey: AuthErrorKey | null }>;
    signUp: (email: string, password: string) => Promise<{ error: string | null; errorKey: AuthErrorKey | null }>;
    signOut: () => Promise<void>;
}

// ============================================================================
// CONTEXT
// ============================================================================

const SupabaseAuthContext = createContext<AuthContextType | undefined>(undefined);

// ============================================================================
// PROVIDER
// ============================================================================

export const SupabaseAuthProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
    const [user, setUser] = useState<User | null>(null);
    const [session, setSession] = useState<Session | null>(null);
    const [loading, setLoading] = useState(true);
    const [isDbReady, setIsDbReady] = useState(false);
    const [sessionExpired, setSessionExpired] = useState(false);

    // Compte pour lequel la base, le trousseau et la synchro sont déjà prêts
    const preparedUserIdRef = useRef<string | null>(null);

    // ---- Init : onAuthStateChange émet INITIAL_SESSION automatiquement (SDK v2) ----
    useEffect(() => {
        const { data: { subscription } } = supabase.auth.onAuthStateChange(
            (_event, newSession) => {
                setSession(newSession);
                setUser(newSession?.user ?? null);
                setLoading(false);
                setSessionExpired(!newSession && wasSessionLost());

                // Phase 2 Multi-User: init DB + Keyring AVANT tout accès
                // INITIAL_SESSION = relancement app avec session existante
                // SIGNED_IN = nouveau login
                const opensSession = (_event === 'SIGNED_IN' || _event === 'INITIAL_SESSION') && !!newSession?.user;

                // Lancement hors ligne (ou réponse inattendue au renouvellement) : INITIAL_SESSION
                // arrive sans session, puis la session revient seule par TOKEN_REFRESHED quand le réseau
                // revient. Tout événement porteur d'une session prépare donc le compte s'il ne l'est pas,
                // sinon l'app passait connectée sans base ouverte.
                // Supabase annonce aussi SIGNED_IN au retour au premier plan, pour le même compte : rien
                // à refaire dans ce cas (base, trousseau, synchro, battement de cœur)
                const needsDbInit = _event !== 'SIGNED_OUT' && !!newSession?.user
                    && preparedUserIdRef.current !== newSession.user.id;

                if (needsDbInit) {
                    preparedUserIdRef.current = newSession.user.id;
                    setDatabaseName(newSession.user.id);
                    setKeyringUser(newSession.user.id);
                    setIsDbReady(true);

                    // Set sync userId (SessionContext handles actual syncOnLogin)
                    setCurrentSyncUserId(newSession.user.id);

                    // Heartbeat fire-and-forget (stats anonymes)
                    void sendHeartbeat(newSession.user.id);
                }

                // Suppression interrompue d'un autre compte : plus reprise au lancement, elle couperait
                // cette session (services/accountDeletion.ts)
                if (newSession?.user && _event !== 'SIGNED_OUT') forgetAccountDeletionOfOtherAccount(newSession.user.id);

                // Compte supprimé depuis un autre appareil : Supabase rouvre la session sans
                // demander au serveur si le compte existe encore. Vérifié aussi au retour au premier plan
                if ((opensSession || needsDbInit) && newSession?.user) scheduleAccountExistenceCheck(newSession.user.id);

                if (_event === 'SIGNED_OUT') {
                    preparedUserIdRef.current = null;
                    // Phase 2 Multi-User: reset caches mémoire AVANT de fermer la DB
                    resetPreferencesCache();
                    resetLiveTvBookmarksCache();
                    resetCatalogCaches(); // accueil et fiches du compte précédent
                    // Actualisation en arrière-plan arrêtée SANS attendre : Supabase tient ici son
                    // verrou de session, et une session expirée n'appelle jamais logout()
                    void stopBackgroundWork();
                    stopCloudResync(); // synchro relancée pendant la session (sync/syncScheduler.ts)
                    stopSyncForSessionChange(); // synchro du guide, sans effacer le guide
                    // Fermer DB + reset noms
                    // Fermeture non attendue (verrou Supabase) : le singleton est libéré tout de suite, donc un
                    // compte qui se connecte aussitôt ouvre sa propre base
                    void closeDatabaseConnection();
                    resetDatabaseName();
                    resetKeyringUser();
                    setIsDbReady(false);
                    setCurrentSyncUserId(null);
                }
            }
        );

        return () => subscription.unsubscribe();
    }, []);

    // Compte supprimé ailleurs pendant que l'app reste ouverte : Supabase ne s'en rend compte
    // qu'au renouvellement du jeton, jusqu'à une heure plus tard. Revérifié à intervalle régulier,
    // seulement quand l'app est affichée
    const userId = user?.id;
    useEffect(() => {
        if (!userId) return;
        const timer = setInterval(() => {
            if (document.visibilityState === 'visible') scheduleAccountExistenceCheck(userId);
        }, ACCOUNT_RECHECK_INTERVAL_MS);
        return () => clearInterval(timer);
    }, [userId]);

    // ---- Actions ----

    const signIn = useCallback(async (email: string, password: string) => {
        try {
            const { error } = await supabase.auth.signInWithPassword({ email, password });
            if (error) return { error: error.message, errorKey: authErrorKey(error) };
        } catch (err) {
            return { error: String(err), errorKey: authErrorKey(err) };
        }
        return { error: null, errorKey: null };
    }, []);

    const signUp = useCallback(async (email: string, password: string) => {
        try {
            const { error } = await supabase.auth.signUp({ email, password });
            if (error) return { error: error.message, errorKey: authErrorKey(error) };
        } catch (err) {
            return { error: String(err), errorKey: authErrorKey(err) };
        }
        return { error: null, errorKey: null };
    }, []);

    // Portée « local » : se déconnecter sur un appareil ne coupe plus la session des autres appareils
    // (par défaut, Supabase révoque toutes les sessions du compte, et les autres appareils se voient
    // ensuite refuser leur jeton : « Refresh Token Not Found »).
    //
    // Hors ligne, Supabase refuse la déconnexion (il doit prévenir le serveur) et garde la session :
    // le compte se rouvrait au lancement suivant. La session est alors effacée de l'appareil quand
    // même. Côté serveur, cette session n'est pas révoquée : son jeton de
    // renouvellement, effacé de l'appareil, reste valable tant que Supabase ne limite pas la durée
    // des sessions.
    const signOut = useCallback(async () => {
        markSignOutRequested();
        try {
            let failure: unknown = null;
            try {
                const { error } = await supabase.auth.signOut({ scope: 'local' });
                failure = error;
            } catch (err) {
                failure = err;
            }
            if (failure) {
                log.warn('Déconnexion non confirmée par le serveur, session effacée de l\'appareil :', failure);
                await forgetSessionOnDevice();
            }
        } finally {
            // SIGNED_OUT est émis pendant l'appel ; s'il ne l'a pas été, la marque tombe
            clearSignOutRequested();
        }
    }, []);

    const value = useMemo(() => ({
        user, session, loading, isDbReady, sessionExpired, signIn, signUp, signOut,
    }), [user, session, loading, isDbReady, sessionExpired, signIn, signUp, signOut]);

    return (
        <SupabaseAuthContext.Provider value={value}>
            {children}
        </SupabaseAuthContext.Provider>
    );
};

// ============================================================================
// HOOK
// ============================================================================

export const useSupabaseAuth = (): AuthContextType => {
    const context = useContext(SupabaseAuthContext);
    if (!context) {
        throw new Error('useSupabaseAuth must be used within a SupabaseAuthProvider');
    }
    return context;
};
