import { describe, it, expect } from 'vitest';
import { formatTimeAgo } from '../timeHelpers';

const now = Date.UTC(2026, 8, 28, 12, 0);
const minutes = (m: number) => now - m * 60_000;

describe('formatTimeAgo', () => {
  it('en minutes, puis en heures, puis en jours', () => {
    expect(formatTimeAgo(minutes(0), now, 'fr')).toBe('maintenant');
    expect(formatTimeAgo(minutes(5), now, 'fr')).toBe('il y a 5 minutes');
    expect(formatTimeAgo(minutes(3 * 60), now, 'fr')).toBe('il y a 3 heures');
    expect(formatTimeAgo(minutes(3 * 24 * 60), now, 'fr')).toBe('il y a 3 jours');
    expect(formatTimeAgo(minutes(3 * 60), now, 'en')).toBe('3 hours ago');
  });

  it('une date dans le futur (horloge décalée) reste « maintenant »', () => {
    expect(formatTimeAgo(now + 60_000, now, 'fr')).toBe('maintenant');
  });
});
