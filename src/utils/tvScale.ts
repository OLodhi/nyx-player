/**
 * tvScale.ts — L'interface TV est dessinée pour une toile fixe, puis mise à l'échelle de l'écran.
 *
 * Les téléviseurs sont en 16:9, mais ne donnent pas la même place à l'app : un Chromecast en 1080p
 * annonce 960 × 540 (densité 2), une box en 720p 1280 × 720, une fenêtre Windows 2560 × 1369.
 * La même page y était mise en page trois fois différemment : ce qui tenait sous Windows débordait
 * sur le Chromecast. Comme les applis web pour TV, on met toujours en page sur la même toile
 * (`TV_CANVAS`), et c'est l'image entière qui est agrandie ou réduite : rendu identique partout,
 * et le mode TV de développement sous Windows montre exactement ce qu'affichera la télé.
 *
 * - Android TV : la page annonce une largeur de mise en page fixe, que la WebView ajuste à l'écran
 *   (`useWideViewPort` activé côté natif, sur TV uniquement : voir NyxAndroidPlugin.kt).
 * - Windows (mode TV du DevPanel) : zoom de la WebView, recalculé quand la fenêtre change de taille.
 * - Preview navigateur (`?preview=androidtv`) : rien, fenêtre à régler sur 1280 × 720.
 */

import { isAndroid } from './platform';

/** Toile de l'interface TV. Seul réglage de lisibilité : plus petite, tout grossit à l'écran. */
export const TV_CANVAS = { width: 1280, height: 720 } as const;

/**
 * Android TV : la page est mise en page sur la largeur de la toile, à l'échelle qui la fait tenir
 * dans l'écran. À appeler avant le premier rendu.
 */
export function applyTvViewport(): void {
  const meta = document.querySelector<HTMLMetaElement>('meta[name="viewport"]');
  if (!meta || !window.screen.width) return;
  const scale = Math.min(window.screen.width / TV_CANVAS.width, window.screen.height / TV_CANVAS.height);
  const value = scale.toFixed(4);
  meta.setAttribute(
    'content',
    `width=${TV_CANVAS.width}, initial-scale=${value}, minimum-scale=${value}, maximum-scale=${value}, user-scalable=no`,
  );
  // Hauteur de la toile, écran entier (720 en 16:9, 800 en 16:10) : ce qui doit garder sa taille quand
  // le clavier système réduit la fenêtre (barre latérale) s'y réfère plutôt qu'à `100vh`.
  document.documentElement.style.setProperty('--tv-canvas-h', `${Math.round(window.screen.height / scale)}px`);
}

/** Zoom qui fait tenir la toile dans une fenêtre de `width` × `height` (pixels logiques). */
export function zoomForWindow(width: number, height: number): number {
  return Math.min(width / TV_CANVAS.width, height / TV_CANVAS.height);
}

type Webview = { setZoom(scaleFactor: number): Promise<void> };

async function currentWebview(): Promise<Webview | null> {
  if (!(window as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ || isAndroid()) return null;
  try {
    const { getCurrentWebview } = await import('@tauri-apps/api/webview');
    return getCurrentWebview();
  } catch {
    return null;
  }
}

/**
 * Mode TV de développement sous Windows : la fenêtre affiche la toile, quelle que soit sa taille.
 * Le zoom réduit la largeur vue par la page : la taille réelle de la fenêtre est `innerWidth × zoom`.
 */
export async function installDesktopTvZoom(): Promise<void> {
  const webview = await currentWebview();
  if (!webview) return;

  let zoom = 1;
  const update = () => {
    const next = zoomForWindow(window.innerWidth * zoom, window.innerHeight * zoom);
    if (!Number.isFinite(next) || next <= 0 || Math.abs(next - zoom) < 0.005) return;
    zoom = next;
    webview.setZoom(next).catch(() => {});
  };
  update();
  window.addEventListener('resize', update);
}

/**
 * Sortie du mode TV sous Windows (compilation de développement) : la WebView garde son zoom d'une
 * page à l'autre, il faut le remettre à 1 au démarrage de l'interface bureau.
 */
export async function resetDesktopZoom(): Promise<void> {
  const webview = await currentWebview();
  await webview?.setZoom(1).catch(() => {});
}
