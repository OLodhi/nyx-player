import { describe, it, expect, vi, afterEach } from 'vitest';
import { formatClock } from '../timeHelpers';

/** Horodatage (secondes) d'une heure locale donnée */
const at = (h: number, m: number) => new Date(2026, 8, 29, h, m).getTime() / 1000;

describe('formatClock', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('affiche HH:MM sur 24 h avec les zéros', () => {
    expect(formatClock(at(0, 5))).toBe('00:05');
    expect(formatClock(at(9, 0))).toBe('09:00');
    expect(formatClock(at(21, 30))).toBe('21:30');
  });

  it("ne dépend pas de la langue de l'appareil (pas de 12 h en anglais)", () => {
    // Un formatage par la langue donnerait « 09:30 PM » sur un appareil anglais
    vi.spyOn(Date.prototype, 'toLocaleTimeString').mockReturnValue('09:30 PM');
    expect(formatClock(at(21, 30))).toBe('21:30');
  });
});
