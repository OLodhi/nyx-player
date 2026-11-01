/**
 * Message bref affiché quelques secondes en bas de l'écran, sur toutes les plateformes
 * (composant `components/Common/AppNotice.tsx`, monté une fois dans main.tsx).
 *
 * Le message est une clé de traduction de `common` : il suit la langue de l'app.
 */

/** Messages possibles : clés de common.json (fr et en) */
export type AppNoticeKey = 'watchlist_update_failed';

export const APP_NOTICE_EVENT = 'nyx:app-notice';

/** Durée d'affichage d'un message */
export const APP_NOTICE_MS = 4000;

export function showAppNotice(messageKey: AppNoticeKey): void {
  window.dispatchEvent(new CustomEvent<AppNoticeKey>(APP_NOTICE_EVENT, { detail: messageKey }));
}
