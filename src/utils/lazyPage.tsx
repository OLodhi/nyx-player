/**
 * lazyPage.tsx — Page chargée à la demande, préchargeable.
 *
 * Les pages secondaires (paramètres, recherche, ma liste, fiches…) forment des blocs séparés : le
 * fichier lu au lancement est plus léger, ce qui compte sur une TV peu puissante. `preload()` les
 * charge en tâche de fond une fois l'accueil affiché ; une page déjà chargée s'affiche alors tout de
 * suite, sans passer par l'attente de <Suspense> (pas d'écran vide d'une image, pas de focus perdu
 * à la télécommande). Sinon, elle s'affiche dès son bloc chargé (fichier local : quelques
 * millisecondes). Le rendu doit se trouver sous un <Suspense>.
 */

import React, { useState, type ComponentType } from 'react';

export type LazyPage<P extends object> = React.FC<P> & {
  /** Charge le bloc de la page (une seule fois ; un échec laisse réessayer). */
  preload: () => Promise<unknown>;
};

export function lazyPage<P extends object>(
  factory: () => Promise<{ default: ComponentType<P> }>,
): LazyPage<P> {
  let loaded: ComponentType<P> | null = null;
  let loading: Promise<{ default: ComponentType<P> }> | null = null;

  const load = () => {
    if (!loading) {
      loading = factory().then(
        (mod) => {
          loaded = mod.default;
          return mod;
        },
        (error: unknown) => {
          loading = null;
          throw error;
        },
      );
    }
    return loading;
  };

  const Lazy = React.lazy(load) as unknown as ComponentType<P>;

  const Page = ((props: P) => {
    // Choisi une fois par montage : passer de Lazy au composant chargé en cours de vie remonterait
    // la page (état perdu)
    const [Ready] = useState(() => loaded);
    return React.createElement(Ready ?? Lazy, props);
  }) as LazyPage<P>;
  Page.preload = load;
  return Page;
}

/**
 * Lance `task` quand le navigateur est inactif (au plus tard après `timeoutMs`), pour ne pas
 * concurrencer l'affichage en cours. Rend la fonction d'annulation.
 */
export function whenIdle(task: () => void, timeoutMs = 3000): () => void {
  if (typeof window.requestIdleCallback === 'function') {
    const id = window.requestIdleCallback(task, { timeout: timeoutMs });
    return () => window.cancelIdleCallback(id);
  }
  const id = window.setTimeout(task, 1000);
  return () => window.clearTimeout(id);
}
