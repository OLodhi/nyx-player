/**
 * iPhone : le lecteur occupe tout l'écran, encoche comprise.
 *
 * Sans `viewport-fit=cover` (index.html), WebKit pose la page dans la zone sûre : les écrans de l'app
 * restent sous la barre d'état et au-dessus de la barre d'accueil sans rien faire. Le lecteur, lui,
 * doit aller jusqu'aux bords comme la vidéo native : il ajoute `viewport-fit=cover` le temps de la
 * lecture, et ses commandes s'écartent elles-mêmes des bords (env(safe-area-inset-*),
 * PlayerControls.css).
 *
 * En paysage, iOS donne la même marge à gauche et à droite, alors que l'encoche n'est que d'un côté.
 * La classe `player-notch-left` ou `player-notch-right` sur <html> indique ce côté d'après l'angle de
 * l'écran, et suit les rotations : seules les commandes de ce côté s'en écartent.
 */

const COVER = 'viewport-fit=cover';
const NOTCH_CLASSES = ['player-notch-left', 'player-notch-right'] as const;

let following = false;

/**
 * Côté de l'encoche d'après l'angle de rotation de l'écran (comme window.orientation sur iOS) :
 * 90° quand le téléphone est tourné vers la gauche (barre d'accueil à droite), le haut et donc
 * l'encoche passent à gauche ; -90° (270°) l'inverse. En portrait, aucune encoche sur les côtés.
 */
export function notchSide(angle: number): 'left' | 'right' | null {
  const normalized = ((angle % 360) + 360) % 360;
  if (normalized === 90) return 'left';
  if (normalized === 270) return 'right';
  return null;
}

function screenAngle(): number {
  const fromScreen = window.screen.orientation?.angle;
  if (typeof fromScreen === 'number') return fromScreen;
  // iOS avant 16.4 : seule l'ancienne propriété existe
  const legacy = (window as Window & { orientation?: number }).orientation;
  return typeof legacy === 'number' ? legacy : 0;
}

function applyNotchSide(): void {
  const side = notchSide(screenAngle());
  const root = document.documentElement;
  root.classList.toggle('player-notch-left', side === 'left');
  root.classList.toggle('player-notch-right', side === 'right');
}

function viewportMeta(): HTMLMetaElement | null {
  return document.querySelector<HTMLMetaElement>('meta[name="viewport"]');
}

/** Ouverture du lecteur (iOS) : page en plein écran et côté de l'encoche suivi. */
export function enterPlayerViewport(): void {
  const meta = viewportMeta();
  if (meta && !meta.content.split(',').some((part) => part.trim() === COVER)) {
    meta.content = `${meta.content}, ${COVER}`;
  }
  applyNotchSide();
  if (!following) {
    window.addEventListener('orientationchange', applyNotchSide);
    window.screen.orientation?.addEventListener?.('change', applyNotchSide);
    following = true;
  }
}

/** Fermeture du lecteur : la page revient dans la zone sûre. */
export function exitPlayerViewport(): void {
  const meta = viewportMeta();
  if (meta) {
    meta.content = meta.content
      .split(',')
      .map((part) => part.trim())
      .filter((part) => part && part !== COVER)
      .join(', ');
  }
  if (following) {
    window.removeEventListener('orientationchange', applyNotchSide);
    window.screen.orientation?.removeEventListener?.('change', applyNotchSide);
    following = false;
  }
  document.documentElement.classList.remove(...NOTCH_CLASSES);
}
