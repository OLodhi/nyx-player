/**
 * Repères de temps pour l'audit performance :
 * permanents mais inertes. Un repère ne fait que noter l'instant dans la chronologie du navigateur
 * (`performance.mark`, de l'ordre de la microseconde) ; rien ne le lit dans l'app. Seul l'outil de
 * mesure les relève, par le protocole de débogage de la version d'audit.
 */
export type PerfMark =
  /** Premier écran stable affiché (connexion ou choix du profil) : fin du démarrage de l'app. */
  | 'first-screen'
  /** Contenu de l'accueil (bannière et carrousels) chargé et remis à l'affichage. */
  | 'home-data-ready'
  /** Lecture du catalogue en mémoire (services/catalogLight.ts) : début, fin de la lecture, index construits. */
  | 'catalog-read-start'
  | 'catalog-read-end'
  | 'catalog-indexed'
  /** Reprise de session : synchro cloud prête (lancée pendant la lecture du catalogue), puis accueil débloqué. */
  | 'resume-cloud-ready'
  | 'resume-done';

export function perfMark(name: PerfMark): void {
  try {
    performance.mark(`nyx:${name}`);
  } catch {
    // Chronologie indisponible (environnement de test ancien) : un repère n'a aucun effet sur l'app
  }
}
