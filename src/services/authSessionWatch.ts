/**
 * Distingue une déconnexion demandée (bouton « Se déconnecter ») d'une session perdue (jeton de
 * renouvellement refusé par Supabase, session effacée par le serveur). Dans le second cas, la page de
 * connexion explique à l'utilisateur que sa session a expiré, au lieu d'un retour muet à l'accueil.
 *
 * Branché sur Supabase dès la création du client (supabaseClient.ts), donc avant le premier
 * renouvellement du démarrage : l'événement SIGNED_OUT de ce renouvellement n'est jamais manqué.
 */

import type { AuthChangeEvent } from '@supabase/supabase-js';
import * as Sentry from '@sentry/react';
import { recentRefreshFailure } from './authRefreshGuard';
import { createLogger } from '../utils/logger';

const log = createLogger('auth');

let signOutRequested = false;
let sessionLost = false;

/** À appeler juste avant `supabase.auth.signOut()` : cette déconnexion-là est voulue. */
export function markSignOutRequested(): void {
  signOutRequested = true;
}

/** Après `signOut()`, réussi ou non : une déconnexion ratée (hors ligne) ne doit pas masquer une perte future. */
export function clearSignOutRequested(): void {
  signOutRequested = false;
}

/** Vrai quand la dernière déconnexion n'a pas été demandée par l'utilisateur. */
export function wasSessionLost(): boolean {
  return sessionLost;
}

/** Écouteur Supabase (`onAuthStateChange`). */
export function trackAuthEvent(event: AuthChangeEvent): void {
  if (event === 'SIGNED_OUT') {
    sessionLost = !signOutRequested;
    signOutRequested = false;
    if (sessionLost) reportSessionLoss();
  } else if (event === 'SIGNED_IN') {
    sessionLost = false;
  }
}

/**
 * Une session perdue se voit sur l'appareil (« Votre session a expiré ») mais sa cause, elle, ne se
 * voyait nulle part : la réponse du serveur au renouvellement est donc écrite dans le journal
 * et envoyée à Sentry (statut et code d'erreur seulement, jamais le jeton ni le compte).
 */
function reportSessionLoss(): void {
  const failure = recentRefreshFailure();
  const age = failure?.sessionAgeHours;
  const ageTag = typeof age === 'number' ? String(age) : 'inconnu';
  const reason = failure
    ? `renouvellement refusé (HTTP ${failure.status}, ${failure.code ?? 'sans code'}, session renouvelée il y a ${typeof age === 'number' ? `${age} h` : 'un temps inconnu'})`
    : 'aucun refus de renouvellement noté (session illisible ou effacée)';
  log.warn(`Session perdue sans déconnexion demandée : ${reason}`);
  Sentry.captureMessage('Session Supabase perdue sans déconnexion demandée', {
    level: 'warning',
    tags: {
      auth_refresh_status: failure ? String(failure.status) : 'aucun',
      auth_refresh_code: failure?.code ?? 'aucun',
      auth_refresh_definitive: failure ? String(failure.definitive) : 'aucun',
      auth_session_age_h: failure ? ageTag : 'aucun',
    },
  });
}

/** Tests uniquement. */
export function resetAuthSessionWatch(): void {
  signOutRequested = false;
  sessionLost = false;
}
