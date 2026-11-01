import { describe, it, expect } from 'vitest';
import { MIN_PASSWORD_LENGTH, isPasswordLongEnough } from '../passwordPolicy';

describe('passwordPolicy', () => {
  it('exige 10 caractères, au moins autant que le serveur', () => {
    expect(MIN_PASSWORD_LENGTH).toBe(10);
    expect(isPasswordLongEnough('123456789')).toBe(false);
    expect(isPasswordLongEnough('1234567890')).toBe(true);
  });
});
