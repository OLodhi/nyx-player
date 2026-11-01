/**
 * viewportHeight.ts — Hauteur réellement visible, clavier virtuel compris.
 *
 * Android : le plugin réduit la WebView de la hauteur du clavier (NyxAndroidPlugin, marge IME).
 * La hauteur visible est exposée en variable CSS `--nyx-viewport-h` (fenêtres ancrées en bas),
 * et la classe `nyx-keyboard-open` sur <html> signale le clavier ouvert (île de navigation masquée).
 */

const VAR_NAME = '--nyx-viewport-h';
const KEYBOARD_CLASS = 'nyx-keyboard-open';
/** Une barre système qui apparaît ou disparaît fait moins ; un clavier fait bien plus */
const KEYBOARD_MIN_PX = 150;

/**
 * Clavier ouvert : la hauteur a fondu d'au moins KEYBOARD_MIN_PX par rapport à la plus grande
 * hauteur vue pour cette largeur. Une rotation change la largeur et repart de zéro.
 */
export function createKeyboardDetector(): (width: number, height: number) => boolean {
  let baseWidth = -1;
  let baseHeight = 0;
  return (width, height) => {
    if (width !== baseWidth) {
      baseWidth = width;
      baseHeight = height;
    }
    baseHeight = Math.max(baseHeight, height);
    return baseHeight - height >= KEYBOARD_MIN_PX;
  };
}

/** Un rétrécissement sans champ de saisie actif (écran partagé) n’est pas un clavier */
function isEditableFocused(): boolean {
  const el = document.activeElement as HTMLElement | null;
  if (!el) return false;
  return el.isContentEditable || el.tagName === 'INPUT' || el.tagName === 'TEXTAREA';
}

export function installViewportHeightVar(): () => void {
  const viewport = window.visualViewport;
  const isKeyboardOpen = createKeyboardDetector();

  const update = () => {
    const width = viewport?.width ?? window.innerWidth;
    const height = viewport?.height ?? window.innerHeight;
    const root = document.documentElement;
    root.style.setProperty(VAR_NAME, `${Math.round(height)}px`);
    const shrunk = isKeyboardOpen(Math.round(width), Math.round(height));
    root.classList.toggle(KEYBOARD_CLASS, shrunk && isEditableFocused());
  };

  update();

  if (!viewport) {
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }

  viewport.addEventListener('resize', update);
  viewport.addEventListener('scroll', update);
  return () => {
    viewport.removeEventListener('resize', update);
    viewport.removeEventListener('scroll', update);
  };
}
