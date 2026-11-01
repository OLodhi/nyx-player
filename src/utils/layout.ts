/**
 * layout.ts — Mise en page compacte (téléphone portrait ou paysage).
 * Doit rester identique à la media query de src/styles/mobile.css, dont les règles
 * ne s'appliquent qu'avec la marque `.nyx-mobile` (main.tsx) : le desktop n'est jamais compact.
 */

import { isMobile } from './platform';

export const COMPACT_LAYOUT_QUERY = '(max-width: 900px), (max-height: 520px)';

export function isCompactLayout(): boolean {
  return isMobile()
    && typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    && window.matchMedia(COMPACT_LAYOUT_QUERY).matches;
}
