import { isMobile, isTv } from './platform';

/**
 * Taille des grandes photos de fond TMDB (fiches, bannière d'accueil). Choix retenu :
 * **qualité inchangée sur PC** (« original », souvent en 4K) ;
 * 1280 px de large sur TV et téléphone. La TV affiche sur une toile de 1280 × 720 : une photo 4K y
 * coûtait ~9 fois plus de pixels à télécharger, décoder et garder en mémoire, sans gain visible.
 */
export function backdropImageSize(): 'w1280' | 'original' {
  return isTv() || isMobile() ? 'w1280' : 'original';
}
