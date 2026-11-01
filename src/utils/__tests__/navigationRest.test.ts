/**
 * Retraits remis au repos de la télécommande : rien n'est retiré tant que des flèches arrivent, tout part d'un coup
 * une fois le repos atteint, avec un seul minuteur.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { isMoving, isServingWhileMoving, releaseAtRest, RELEASE_STEP_MS, REST_DELAY_MS, STILL_DELAY_MS, whenStill } from '../spatialNavigation/navigationRest';

const arrow = (key = 'ArrowDown') => window.dispatchEvent(new KeyboardEvent('keydown', { key }));

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
});

describe('releaseAtRest', () => {
  it('retire une fois REST_DELAY_MS passées sans flèche, pas avant', () => {
    arrow();
    const release = vi.fn();
    releaseAtRest(release);
    vi.advanceTimersByTime(REST_DELAY_MS - 1);
    expect(release).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(release).toHaveBeenCalledTimes(1);
  });

  it('le délai part de la dernière flèche, pas de la demande', () => {
    arrow();
    vi.advanceTimersByTime(400);
    const release = vi.fn();
    releaseAtRest(release);
    vi.advanceTimersByTime(REST_DELAY_MS - 400);
    expect(release).toHaveBeenCalledTimes(1);
  });

  it('repos déjà atteint : retiré peu après, jamais dans la tâche en cours', () => {
    arrow();
    vi.advanceTimersByTime(REST_DELAY_MS * 2);
    const release = vi.fn();
    releaseAtRest(release);
    expect(release).not.toHaveBeenCalled();
    vi.advanceTimersByTime(RELEASE_STEP_MS);
    expect(release).toHaveBeenCalledTimes(1);
  });

  it('une flèche relance l\'attente ; une autre touche non', () => {
    arrow();
    const release = vi.fn();
    releaseAtRest(release);
    vi.advanceTimersByTime(REST_DELAY_MS - 100);
    arrow('ArrowRight');
    vi.advanceTimersByTime(REST_DELAY_MS - 100);
    expect(release).not.toHaveBeenCalled();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    vi.advanceTimersByTime(100);
    expect(release).toHaveBeenCalledTimes(1);
  });

  it('plusieurs retraits : un seul minuteur, un retrait par tâche, dans l\'ordre des demandes', () => {
    arrow();
    const order: string[] = [];
    releaseAtRest(() => order.push('a'));
    vi.advanceTimersByTime(300);
    releaseAtRest(() => order.push('b'));
    releaseAtRest(() => order.push('c'));
    expect(vi.getTimerCount()).toBe(1);
    vi.advanceTimersByTime(REST_DELAY_MS - 300);
    expect(order).toEqual(['a']);
    expect(vi.getTimerCount()).toBe(1);
    vi.advanceTimersByTime(RELEASE_STEP_MS);
    expect(order).toEqual(['a', 'b']);
    vi.advanceTimersByTime(RELEASE_STEP_MS);
    expect(order).toEqual(['a', 'b', 'c']);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('une flèche entre deux retraits suspend la suite jusqu\'au repos suivant', () => {
    arrow();
    const order: string[] = [];
    ['a', 'b', 'c'].forEach((name) => releaseAtRest(() => order.push(name)));
    vi.advanceTimersByTime(REST_DELAY_MS);
    expect(order).toEqual(['a']);
    arrow();
    vi.advanceTimersByTime(REST_DELAY_MS - 1);
    expect(order).toEqual(['a']);
    vi.advanceTimersByTime(1);
    expect(order).toEqual(['a', 'b']);
    vi.advanceTimersByTime(RELEASE_STEP_MS);
    expect(order).toEqual(['a', 'b', 'c']);
  });

  it('l\'annulation retire la demande, et le minuteur quand plus rien n\'attend', () => {
    arrow();
    const release = vi.fn();
    const cancel = releaseAtRest(release);
    cancel();
    expect(vi.getTimerCount()).toBe(0);
    vi.advanceTimersByTime(REST_DELAY_MS * 2);
    expect(release).not.toHaveBeenCalled();
    // Une flèche sans retrait en attente ne relance aucun minuteur
    arrow();
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('whenStill : ce qui attend l\'arrêt de la sélection', () => {
  const frameTimers: Parameters<typeof vi.useFakeTimers>[0] = { toFake: ['setTimeout', 'clearTimeout', 'Date', 'requestAnimationFrame', 'cancelAnimationFrame'] };

  it('pendant le mouvement : deux demandes par image, la rangée sélectionnée puis l\'écran ; le reste attend l\'arrêt', () => {
    vi.useFakeTimers(frameTimers);
    arrow();
    const served: string[] = [];
    whenStill(() => served.push('loin'), () => 2);
    whenStill(() => served.push('écran 1'), () => 1);
    whenStill(() => served.push('écran 2'), () => 1);
    whenStill(() => served.push('sélection'), () => 0);
    expect(served).toEqual([]);
    vi.advanceTimersByTime(17);
    expect(served).toEqual(['sélection', 'écran 1']);
    vi.advanceTimersByTime(17);
    expect(served).toEqual(['sélection', 'écran 1', 'écran 2']);
    // Toujours en mouvement : la demande hors de l'écran ne passe pas
    vi.advanceTimersByTime(100);
    expect(isMoving()).toBe(true);
    expect(served).toHaveLength(3);
    vi.advanceTimersByTime(STILL_DELAY_MS);
    expect(isMoving()).toBe(false);
    expect(served).toEqual(['sélection', 'écran 1', 'écran 2', 'loin']);
  });

  it('à l\'arrêt : deux demandes par image, les plus prioritaires d\'abord ; une flèche suspend la suite', () => {
    vi.useFakeTimers(frameTimers);
    arrow();
    const served: string[] = [];
    for (let i = 0; i < 5; i += 1) whenStill(() => served.push(`loin ${i}`), () => 2 + i);
    vi.advanceTimersByTime(STILL_DELAY_MS);
    expect(served).toEqual(['loin 0', 'loin 1']);
    arrow();
    vi.advanceTimersByTime(17 * 3);
    expect(served).toHaveLength(2);
    // Arrêt atteint STILL_DELAY_MS après cette flèche : deux de plus, la dernière à l'image suivante
    vi.advanceTimersByTime(STILL_DELAY_MS - 17 * 3);
    expect(served).toEqual(['loin 0', 'loin 1', 'loin 2', 'loin 3']);
    vi.advanceTimersByTime(17);
    expect(served).toHaveLength(5);
  });

  it('sélection déjà à l\'arrêt : servi peu après, jamais dans la tâche en cours ; une demande annulée ne l\'est jamais', () => {
    vi.useFakeTimers(frameTimers);
    arrow();
    vi.advanceTimersByTime(STILL_DELAY_MS * 2);
    const run = vi.fn();
    const cancelled = vi.fn();
    whenStill(run);
    whenStill(cancelled)();
    expect(run).not.toHaveBeenCalled();
    vi.advanceTimersByTime(17);
    expect(run).toHaveBeenCalledTimes(1);
    expect(cancelled).not.toHaveBeenCalled();
  });

  it('une demande servie en plein mouvement le sait (elle ne doit pas se remettre à attendre)', () => {
    vi.useFakeTimers(frameTimers);
    arrow();
    const seen: boolean[] = [];
    whenStill(() => seen.push(isServingWhileMoving()), () => 0);
    vi.advanceTimersByTime(17);
    expect(seen).toEqual([true]);
    expect(isServingWhileMoving()).toBe(false);
    whenStill(() => seen.push(isServingWhileMoving()), () => 2);
    vi.advanceTimersByTime(STILL_DELAY_MS + 17);
    expect(seen).toEqual([true, false]);
  });
});

describe('whenStill : une demande qui échoue', () => {
  it('ne bloque pas les suivantes', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date', 'requestAnimationFrame', 'cancelAnimationFrame'] });
    arrow();
    vi.advanceTimersByTime(STILL_DELAY_MS * 2);
    const served: string[] = [];
    whenStill(() => {
      throw new Error('échec');
    }, () => 0);
    for (let i = 0; i < 3; i += 1) whenStill(() => served.push(`suivante ${i}`), () => 1);
    expect(() => vi.advanceTimersByTime(17)).toThrow('échec');
    vi.advanceTimersByTime(17 * 3);
    expect(served).toEqual(['suivante 0', 'suivante 1', 'suivante 2']);
  });

  it('ne bloque pas la seule autre demande servie dans la même image', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date', 'requestAnimationFrame', 'cancelAnimationFrame'] });
    arrow();
    vi.advanceTimersByTime(STILL_DELAY_MS * 2);
    const served: string[] = [];
    whenStill(() => {
      throw new Error('échec');
    }, () => 0);
    whenStill(() => served.push('suivante'), () => 1);
    expect(() => vi.advanceTimersByTime(17)).toThrow('échec');
    vi.advanceTimersByTime(17 * 3);
    expect(served).toEqual(['suivante']);
  });
});
