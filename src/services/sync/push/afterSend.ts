/**
 * afterSend.ts — Mise à jour du dernier accord avec le cloud après un envoi réussi
 *
 * Partagé par tous les envois de push/ (voir syncPush.ts).
 */

import { updateBaseline as updateBaselineNow } from '../syncBaseline';
import type { BaselineScope, BaselineChanges } from '../syncBaseline';

/**
 * Dernier accord mis à jour après un envoi, seulement si rien n'a été effacé depuis le départ de
 * l'envoi (connexion, remise à zéro) : sinon l'envoi remettrait un élément dans un dernier accord
 * qu'on vient de vider.
 */
export function afterSend(userId: string, scope: BaselineScope, generation: number, changes: BaselineChanges): Promise<void> {
  return updateBaselineNow(userId, scope, { ...changes, generation });
}
