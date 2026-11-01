/**
 * Variantes de fluidité à essayer sur l'appareil — **version de mesure uniquement** (`VITE_PERF=1`).
 * Absent de toute version publiée : tout est derrière `PERF_ENABLED`, qui vaut false à la compilation.
 *
 * Sur le Chromecast, la navigation à la télécommande sur l'accueil n'affiche que ≈ 19 images/s
 * (64 % en retard), surtout à cause du dessin. Chaque variante retire une dépense possible ; on les
 * active depuis l'écran des profils de Nyx Mesure et on mesure (compteur d'images d'Android) avant de
 * décider quoi garder dans Nyx. Mémorisées sur l'appareil, appliquées dès le démarrage.
 */
import { PERF_ENABLED } from './perfHook';
import { setLegacyRail } from '../components/Iptv/rail/rail';
import { setBareWaitingCard } from '../components/Iptv/rail/railRow';
import { rowContentOf } from '../utils/spatialNavigation/rowHost';
import { clearShrunkPosters, setShrinkProviderPosters } from '../components/Lists/tvPoster';
import { setGridPostersPaced } from '../components/Lists/gridPoster';

/**
 * Seuls restent les témoins utiles à un futur travail de fluidité. Les essais tranchés (défilement instantané,
 * animé v1 ou ancien, arrivée de rangée, pas vertical, appuis non freinés, calques, carte sans agrandissement doux,
 * rangées React sur TV) sont retirés avec leur code : leur réglage retenu est celui de Nyx.
 */
export type PerfVariant =
  | 'no-blur'
  | 'posters-original'
  | 'rail-legacy'
  | 'poster-old-img'
  | 'see-all-before';

export const PERF_VARIANTS: { id: PerfVariant; label: string }[] = [
  { id: 'no-blur', label: 'Aucun autre flou (bannière, boutons, fenêtres)' },
  { id: 'posters-original', label: 'Accueil TV : affiches du fournisseur telles quelles, sans réduction par l’appli native (à l’ouverture suivante de l’accueil)' },
  { id: 'rail-legacy', label: 'Accueil Films / Séries / Suggestions : rail d’avant, témoin des mesures (affiches posées tout de suite même en mouvement, 6 rangées montées, affiches gardées au repos ; toujours sans fondu, ancienne affiche retirée ; à l’ouverture suivante de l’accueil)' },
  { id: 'poster-old-img', label: 'Accueil TV : ancienne image d’affiche (gardée sans adresse dans la carte en attente, montrée pendant son chargement, texte de remplacement), témoin de la case grise nue' },
  { id: 'see-all-before', label: 'Voir tout (TV) : affiches d’avant la version C, témoin des mesures (adresse d’origine posée tout de suite, même en mouvement, texte de remplacement ; à la prochaine ouverture de « Voir tout »)' },
];

// Variantes « barre latérale sans flou » et « carte sans animation » retirées, Nyx le fait déjà sur TV
// (tv.css).
const STORAGE_KEY = 'nyx-perf-variants';
/** Événement de `window` envoyé à chaque application des variantes */
export const VARIANTS_EVENT = 'nyx-perf-variants';

export function readVariants(): Set<PerfVariant> {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]') as PerfVariant[];
    return new Set(saved.filter((id) => PERF_VARIANTS.some((v) => v.id === id)));
  } catch {
    return new Set();
  }
}

export function applyVariants(active: Set<PerfVariant>): void {
  for (const { id } of PERF_VARIANTS) document.documentElement.classList.toggle(`nyx-perf-${id}`, active.has(id));
  setLegacyRail(active.has('rail-legacy'));
  setShrinkProviderPosters(!active.has('posters-original'));
  setBareWaitingCard(!active.has('poster-old-img'));
  setGridPostersPaced(!active.has('see-all-before'));
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([...active]));
  } catch {
    // Stockage indisponible : les variantes valent pour cette ouverture seulement
  }
  // Écran des profils : ses boutons suivent aussi un réglage fait à distance (`__nyxPerfVariants`)
  window.dispatchEvent(new CustomEvent<PerfVariant[]>(VARIANTS_EVENT, { detail: [...active] }));
}

declare global {
  interface Window {
    /** Pilotage à distance pendant une mesure (Nyx Mesure `-Debogage`) : `__nyxPerfVariants(['no-blur'])`. */
    __nyxPerfVariants?: (ids: PerfVariant[]) => PerfVariant[];
    /** Contenu affiché pour un emplacement de rangée (rail recyclé : ailleurs dans la page), pour les mesures */
    __nyxRowContent?: (place: Element) => Element;
    /** Affiches réduites effacées du disque, pour les mesures d'une première ouverture */
    __nyxPosterCacheClear?: () => Promise<unknown>;
  }
}

if (PERF_ENABLED && typeof window !== 'undefined') {
  // Styles en texte (`?inline`) posés dans une balise <style> : pas de bloc à la demande porteur de
  // CSS, que le build refuse (vite.config.ts, forbid-lazy-chunk-css). Ils l'emportent sur tv.css par
  // leur spécificité (:root.nyx-tv.nyx-perf-…), pas par leur place. Version de mesure seulement.
  void import('./perfVariants.css?inline').then(({ default: css }) => {
    const style = document.createElement('style');
    style.dataset.nyxPerfVariants = '';
    style.textContent = css;
    document.head.append(style);
  });
  applyVariants(readVariants());
  window.__nyxRowContent = rowContentOf;
  window.__nyxPosterCacheClear = clearShrunkPosters;
  window.__nyxPerfVariants = (ids) => {
    applyVariants(new Set(ids.filter((id) => PERF_VARIANTS.some((v) => v.id === id))));
    return [...readVariants()];
  };
}
