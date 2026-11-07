/**
 * Lecteur sur iPhone : la vidéo et les dégradés des barres vont jusqu'aux bords de l'écran, les
 * commandes restent hors de l'encoche et de la barre d'accueil.
 *
 * Les marges viennent de env(safe-area-inset-*), qui vaut 0 partout sauf sur iOS (Android règle les
 * marges du WebView lui-même) : rien ne change sur Android ni sous Windows. En paysage, iOS donne la
 * même marge à gauche et à droite ; seul le côté de l'encoche (classe posée par
 * iosPlayerViewport.ts) l'applique.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const read = (path: string) =>
  readFileSync(resolve(process.cwd(), path), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

/** Corps de la règle dont le sélecteur est exactement `selector`. */
const ruleBody = (css: string, selector: string): string =>
  [...css.matchAll(/([^{};]+)\{([^{}]*)\}/g)].find((m) => m[1].trim() === selector)?.[2] ?? '';

const player = read('src/components/PlayerControls.css');

describe('PlayerControls.css — zone sûre de l\'iPhone', () => {
  it('haut et bas : marges du système ; côtés : aucune par défaut', () => {
    const body = ruleBody(player, '.player-overlay');
    expect(body).toMatch(/--player-inset-top:\s*env\(safe-area-inset-top\)/);
    expect(body).toMatch(/--player-inset-bottom:\s*env\(safe-area-inset-bottom\)/);
    expect(body).toMatch(/--player-inset-left:\s*0px/);
    expect(body).toMatch(/--player-inset-right:\s*0px/);
  });

  it('côtés : la marge de l\'encoche, de son côté seulement', () => {
    expect(ruleBody(player, 'html.player-notch-left .player-overlay')).toMatch(/--player-inset-left:\s*env\(safe-area-inset-left\)/);
    expect(ruleBody(player, 'html.player-notch-right .player-overlay')).toMatch(/--player-inset-right:\s*env\(safe-area-inset-right\)/);
    // Nulle part ailleurs : sinon les deux côtés s'écarteraient en paysage
    const elsewhere = player
      .replace(/html\.player-notch-left \.player-overlay\s*\{[^}]*\}/, '')
      .replace(/html\.player-notch-right \.player-overlay\s*\{[^}]*\}/, '');
    expect(elsewhere).not.toMatch(/safe-area-inset-(left|right)/);
  });

  it('les commandes restent dans la zone sûre', () => {
    const body = ruleBody(player, '.player-ui-safe-area');
    expect(body).toMatch(/top:\s*var\(--player-inset-top\)/);
    expect(body).toMatch(/bottom:\s*var\(--player-inset-bottom\)/);
    expect(body).toMatch(/right:\s*var\(--player-inset-right\)/);
    expect(body).toMatch(/left:\s*calc\(var\(--switcher-offset, 0px\) \+ var\(--player-inset-left\)\)/);
  });

  it('les dégradés des barres débordent jusqu\'aux bords, leur contenu non', () => {
    const top = ruleBody(player, '.player-top-bar');
    expect(top).toMatch(/margin:\s*calc\(-1 \* var\(--player-inset-top\)\) calc\(-1 \* var\(--player-inset-right\)\) 0 calc\(-1 \* var\(--player-inset-left\)\)/);
    expect(top).toMatch(/padding:\s*calc\(1rem \+ var\(--player-inset-top\)\) calc\(1\.25rem \+ var\(--player-inset-right\)\) 1rem calc\(1\.25rem \+ var\(--player-inset-left\)\)/);
    const bottom = ruleBody(player, '.player-bottom-bar');
    expect(bottom).toMatch(/margin:\s*0 calc\(-1 \* var\(--player-inset-right\)\) calc\(-1 \* var\(--player-inset-bottom\)\) calc\(-1 \* var\(--player-inset-left\)\)/);
    expect(bottom).toMatch(/padding:\s*0 calc\(1\.25rem \+ var\(--player-inset-right\)\) calc\(1rem \+ var\(--player-inset-bottom\)\) calc\(1\.25rem \+ var\(--player-inset-left\)\)/);
  });
});

describe('panneaux du lecteur — hors de l\'encoche', () => {
  it('liste des chaînes (téléphone) : contenu décalé, panneau à sa largeur habituelle', () => {
    const css = read('src/components/Tv/ChannelSwitcher.css');
    const body = ruleBody(css, '.channel-switcher-compact__panel');
    expect(body).toMatch(/padding:\s*calc\(var\(--space-3\) \+ var\(--player-inset-top\)\) var\(--space-2\) var\(--player-inset-bottom\) calc\(var\(--space-3\) \+ var\(--player-inset-left\)\)/);
  });

  it('liste des épisodes : écartée de l\'encoche à droite, du haut et du bas', () => {
    const css = read('src/components/Player/EpisodeSwitcher.css');
    const body = ruleBody(css, '.episode-switcher-overlay');
    expect(body).toMatch(/top:\s*calc\(1rem \+ var\(--player-inset-top\)\)/);
    expect(body).toMatch(/right:\s*calc\(1rem \+ var\(--player-inset-right\)\)/);
    expect(body).toMatch(/bottom:\s*calc\(var\(--player-controls-height\) \+ var\(--player-inset-bottom\)\)/);
  });
});
