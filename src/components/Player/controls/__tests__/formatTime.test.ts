import { describe, it, expect } from 'vitest';
import { formatTime } from '../formatTime';

describe('formatTime', () => {
  it('affiche 0:00 sans durée connue', () => {
    expect(formatTime(0)).toBe('0:00');
    expect(formatTime(NaN)).toBe('0:00');
  });

  it('affiche minutes et secondes sous une heure', () => {
    expect(formatTime(5)).toBe('0:05');
    expect(formatTime(65.9)).toBe('1:05');
    expect(formatTime(3599)).toBe('59:59');
  });

  it('ajoute les heures au-delà', () => {
    expect(formatTime(3600)).toBe('1:00:00');
    expect(formatTime(3 * 3600 + 7 * 60 + 9)).toBe('3:07:09');
  });
});
