/**
 * iPhone : le lecteur occupe tout l'écran, encoche comprise.
 *
 * Sans `viewport-fit=cover`, WebKit pose la page dans la zone sûre : en paysage, 47 pt de chaque
 * côté et 21 pt en bas sur un iPhone 13. La vidéo native remplissait l'écran, mais les commandes et
 * leurs dégradés s'arrêtaient au bord de la zone sûre (un cadre visible). Le lecteur passe donc la
 * page en plein écran le temps de la lecture, et indique de quel côté se trouve l'encoche, pour que
 * les commandes ne s'en écartent que de ce côté (iOS donne la même marge des deux côtés).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { enterPlayerViewport, exitPlayerViewport, notchSide } from '../iosPlayerViewport';

const BASE = 'width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no';

const meta = () => document.querySelector<HTMLMetaElement>('meta[name="viewport"]');

/** Angle de rotation de l'écran (screen.orientation.angle sur iOS 16.4 et plus) */
function setAngle(angle: number) {
  Object.defineProperty(window.screen, 'orientation', { configurable: true, value: { angle } });
  window.dispatchEvent(new Event('orientationchange'));
}

describe('notchSide', () => {
  // Téléphone tourné vers la gauche (bouton d'accueil, ou barre, à droite) : le haut, donc
  // l'encoche, passe à gauche
  it('90° : encoche à gauche', () => expect(notchSide(90)).toBe('left'));
  it('270° (ou -90°) : encoche à droite', () => {
    expect(notchSide(270)).toBe('right');
    expect(notchSide(-90)).toBe('right');
  });
  it('portrait : aucune encoche sur les côtés', () => {
    expect(notchSide(0)).toBeNull();
    expect(notchSide(180)).toBeNull();
  });
});

describe('page plein écran pendant la lecture (iOS)', () => {
  beforeEach(() => {
    document.head.innerHTML = `<meta name="viewport" content="${BASE}" />`;
    document.documentElement.className = '';
    setAngle(0);
  });
  afterEach(() => exitPlayerViewport());

  it('ajoute viewport-fit=cover à l\'ouverture et rend la valeur d\'origine à la fermeture', () => {
    enterPlayerViewport();
    expect(meta()?.content).toBe(`${BASE}, viewport-fit=cover`);
    exitPlayerViewport();
    expect(meta()?.content).toBe(BASE);
  });

  it('deux ouvertures de suite : une seule fois viewport-fit=cover', () => {
    enterPlayerViewport();
    enterPlayerViewport();
    expect(meta()?.content).toBe(`${BASE}, viewport-fit=cover`);
    exitPlayerViewport();
    expect(meta()?.content).toBe(BASE);
  });

  it('indique le côté de l\'encoche et le suit quand le téléphone tourne', () => {
    setAngle(90);
    enterPlayerViewport();
    expect(document.documentElement.classList.contains('player-notch-left')).toBe(true);

    setAngle(270);
    expect(document.documentElement.classList.contains('player-notch-left')).toBe(false);
    expect(document.documentElement.classList.contains('player-notch-right')).toBe(true);

    setAngle(0);
    expect(document.documentElement.classList.contains('player-notch-right')).toBe(false);
  });

  it('fermeture : plus de classe ni de suivi de la rotation', () => {
    setAngle(90);
    enterPlayerViewport();
    exitPlayerViewport();
    expect(document.documentElement.classList.contains('player-notch-left')).toBe(false);
    setAngle(270);
    expect(document.documentElement.classList.contains('player-notch-right')).toBe(false);
  });
});
