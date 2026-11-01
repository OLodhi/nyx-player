/**
 * sendInBackground.ts — Envoi vers le cloud sans attente (fire-and-forget), erreurs comprises
 *
 * Supabase rend ses erreurs dans `error` au lieu de rejeter, mais la requête peut quand même
 * rejeter (réseau, client), et la suite d'un envoi réussi (dernier accord, syncBaseline.ts) peut
 * échouer sur une base fermée : sans ce garde, ces échecs devenaient des promesses rejetées non
 * traitées. Un envoi raté est rattrapé par la synchro suivante.
 */

import { createLogger } from '../../../utils/logger';
import { isCloudLimitRefusal, noteCloudRefusal } from '../cloudRefusal';

const log = createLogger('Sync');

type CloudResponse = { error: { message: string; code?: string } | null };

export function sendInBackground(
  request: PromiseLike<CloudResponse>,
  what: string,
  onSent?: () => void | Promise<void>,
): void {
  Promise.resolve(request)
    .then(async ({ error }) => {
      if (error) {
        // Borne dépassée : signalé à l'écran (sync/cloudRefusal.ts)
        if (isCloudLimitRefusal(error)) noteCloudRefusal();
        log.warn(`Fire-and-forget ${what} failed:`, error.message);
        return;
      }
      await onSent?.();
    })
    .catch((err: unknown) => log.warn(`Fire-and-forget ${what} failed:`, err));
}
