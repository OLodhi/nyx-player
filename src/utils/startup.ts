import { createLogger } from './logger';

const log = createLogger('Startup');

/**
 * Démarrage de l'interface : attend la préparation (mode preview, détection de l'appareil), règle la
 * plateforme puis monte React. Un échec de l'une des deux premières étapes est journalisé et le
 * montage a lieu quand même, avec les valeurs par défaut (tactile / bureau) : sans cela, la fenêtre
 * s'affichait au bout de 5 s mais restait vide.
 */
export async function runStartup(
  ready: Promise<unknown>,
  preparePlatform: () => void,
  mount: () => void,
): Promise<void> {
  try {
    await ready;
  } catch (err) {
    log.error('Préparation en échec, démarrage avec les valeurs par défaut :', err);
  }
  try {
    preparePlatform();
  } catch (err) {
    log.error('Réglage de la plateforme en échec :', err);
  }
  mount();
}
