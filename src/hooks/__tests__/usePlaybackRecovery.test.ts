/**
 * Tests pour usePlaybackRecovery.ts — le compteur de relances ne repart à zéro
 * qu'après un vrai progrès de lecture.
 */

import { describe, it, expect, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { usePlaybackRecovery } from '../usePlaybackRecovery';
import { RECOVERY_PLAYBACK_S } from '../../services/player/playbackErrors';

interface Props { time: number; attempt: number; hasError: boolean }

function setup(initial: Partial<Props> = {}) {
  const onRecovered = vi.fn();
  const hook = renderHook(
    ({ time, attempt, hasError }: Props) => usePlaybackRecovery(time, attempt, hasError, onRecovered),
    { initialProps: { time: 0, attempt: 1, hasError: false, ...initial } },
  );
  let props: Props = { time: 0, attempt: 1, hasError: false, ...initial };
  const update = (patch: Partial<Props>) => {
    props = { ...props, ...patch };
    hook.rerender(props);
  };
  /** Fait défiler la vidéo de `seconds` secondes, par pas de `step` (time-pos émis toutes les 250 ms sur Android) */
  const play = (seconds: number, step = 0.25) => {
    const steps = Math.round(seconds / step);
    for (let i = 0; i < steps; i++) update({ time: props.time + step });
  };
  return { onRecovered, update, play, get props() { return props; } };
}

describe('usePlaybackRecovery', () => {
  it('confirme la reprise après RECOVERY_PLAYBACK_S secondes de lecture réelle, une seule fois', () => {
    const t = setup({ time: 1200 });
    t.play(RECOVERY_PLAYBACK_S - 1);
    expect(t.onRecovered).not.toHaveBeenCalled();

    t.play(2);
    expect(t.onRecovered).toHaveBeenCalledTimes(1);
  });

  it('ne confirme rien pour un flux ouvert mais bloqué (position immobile), quelle que soit la durée', () => {
    const t = setup({ time: 500 });
    for (let i = 0; i < 1000; i++) t.update({ time: 500 });
    expect(t.onRecovered).not.toHaveBeenCalled();
  });

  it('ne compte pas les sauts de position (seek, nouveau flux dont l\'horloge démarre ailleurs)', () => {
    const t = setup({ time: 0 });
    t.update({ time: 3600 }); // horloge d'un direct
    t.update({ time: 3700 }); // saut
    t.update({ time: 3500 }); // retour arrière
    expect(t.onRecovered).not.toHaveBeenCalled();
  });

  it('ne fait rien sans relance en cours, ni pendant un écran d\'erreur', () => {
    const idle = setup({ attempt: 0 });
    idle.play(RECOVERY_PLAYBACK_S * 2);
    expect(idle.onRecovered).not.toHaveBeenCalled();

    const failing = setup({ hasError: true });
    failing.play(RECOVERY_PLAYBACK_S * 2);
    expect(failing.onRecovered).not.toHaveBeenCalled();
  });

  it('recommence la mesure à chaque nouvelle relance', () => {
    const t = setup({ time: 0 });
    t.play(RECOVERY_PLAYBACK_S - 10);
    // Le flux retombe, erreur puis nouvelle relance : les secondes déjà jouées ne comptent plus
    t.update({ hasError: true });
    t.update({ hasError: false, attempt: 2, time: 0 });
    t.play(RECOVERY_PLAYBACK_S - 10);
    expect(t.onRecovered).not.toHaveBeenCalled();

    t.play(11);
    expect(t.onRecovered).toHaveBeenCalledTimes(1);
  });
});
