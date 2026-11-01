/**
 * Déconnexion hors ligne : Supabase refuse de se déconnecter sans réseau (il doit prévenir
 * le serveur) et garde la session sur l'appareil, qui se rouvrait au lancement suivant.
 */

import { supabase } from './supabaseClient';
import { createLogger } from '../utils/logger';

const log = createLogger('Auth');

/**
 * Efface la session de l'appareil sans passer par le serveur : même effacement que la déconnexion
 * réussie de Supabase (session, vérificateur, utilisateur), puis SIGNED_OUT, qui ferme la base et
 * remet l'app à l'écran de connexion. Supabase n'offre pas d'appel public pour cela ; sa méthode
 * interne est vérifiée par un test à chaque mise à jour de la bibliothèque.
 */
export async function forgetSessionOnDevice(): Promise<void> {
    const auth = supabase.auth as unknown as {
        _removeSession?: () => Promise<void>;
        stopAutoRefresh: () => Promise<void>;
        startAutoRefresh: () => Promise<void>;
    };
    if (typeof auth._removeSession !== 'function') {
        log.error('Session impossible à effacer hors ligne : méthode Supabase introuvable');
        return;
    }
    // Renouvellement automatique arrêté pendant l'effacement : un renouvellement déjà lancé qui
    // aboutirait juste après (réseau revenu) réenregistrerait la session. Relancé ensuite pour la
    // prochaine connexion (sans session, il ne fait rien).
    try {
        await auth.stopAutoRefresh();
        await auth._removeSession();
    } catch (err) {
        log.error('Session non effacée de l\'appareil :', err);
    } finally {
        await auth.startAutoRefresh().catch(() => {});
    }
}
