/**
 * CSS Helpers — Utilitaires CSS partagés.
 *
 * Centralise les conversions d'unités CSS pour éviter la duplication
 * entre les composants (VirtualContentCarousel, GuideTvGrid, etc.).
 */

/**
 * Convertit une valeur en `rem` vers sa valeur en `px`
 * en se basant sur le `font-size` du `<html>`.
 *
 * @param remVal — Valeur en rem à convertir
 * @returns Valeur équivalente en pixels
 */
export function remToPx(remVal: number): number {
  return remVal * parseFloat(getComputedStyle(document.documentElement).fontSize);
}

/**
 * Mesure en `px` une longueur CSS (variable, calc, max...) en la faisant résoudre par le navigateur.
 * `getComputedStyle` ne résout pas les propriétés personnalisées : on passe par un élément témoin.
 * Renvoie 0 hors navigateur ou si la valeur ne se résout pas.
 */
export function measureCssLength(expression: string, scope: HTMLElement = document.body): number {
  const probe = document.createElement('div');
  probe.style.cssText = `position:absolute;visibility:hidden;pointer-events:none;width:${expression};height:0`;
  scope.appendChild(probe);
  const width = probe.getBoundingClientRect().width;
  probe.remove();
  return Number.isFinite(width) ? width : 0;
}
