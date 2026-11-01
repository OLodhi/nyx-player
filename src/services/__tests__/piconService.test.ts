/**
 * Tests unitaires pour piconService.ts
 *
 * Vérifie que le mapping externalisé (channel-mapping.json)
 * est correctement chargé et utilisé par le service.
 */

import { describe, it, expect } from 'vitest';
import { normalizeChannelName } from '../../utils/normalizeChannelName';
import channelMapping from '../../data/channel-mapping.json';

describe('channel-mapping.json', () => {
  it('contient les chaînes françaises principales', () => {
    expect(channelMapping).toHaveProperty('tf1', 'france/tf1-fr');
    expect(channelMapping).toHaveProperty('france-2', 'france/france-2-fr');
    expect(channelMapping).toHaveProperty('m6', 'france/m6-fr');
    expect(channelMapping).toHaveProperty('canal-plus', 'france/canal-plus-fr');
  });

  it('contient les chaînes belges', () => {
    expect(channelMapping).toHaveProperty('rtbf-la-une', 'belgium/rtbf-la-une-be');
    expect(channelMapping).toHaveProperty('rtl-tvi', 'belgium/rtl-tvi-be');
  });

  it('a au moins 50 entrées', () => {
    const count = Object.keys(channelMapping).length;
    expect(count).toBeGreaterThanOrEqual(50);
  });

  it('toutes les clés sont en lowercase avec tirets', () => {
    for (const key of Object.keys(channelMapping)) {
      expect(key).toMatch(/^[a-z0-9-]+$/);
    }
  });

  it('toutes les valeurs contiennent un slash pays/nom', () => {
    for (const value of Object.values(channelMapping)) {
      expect(value).toMatch(/^[a-z]+\/[a-z0-9-]+$/);
    }
  });
});

describe('normalizeChannelName — cohérence avec le mapping', () => {
  it('normalise TF1 correctement', () => {
    expect(normalizeChannelName('TF1 FHD [FR]')).toBe('tf1');
  });

  it('normalise France 2 correctement', () => {
    expect(normalizeChannelName('France 2 4K')).toBe('france-2');
  });

  it('normalise Canal+ Sport correctement', () => {
    expect(normalizeChannelName('Canal+ Sport')).toBe('canal-plus-sport');
  });

  it('la normalisation est idempotente', () => {
    const name = 'BFM TV HD [FR]';
    const first = normalizeChannelName(name);
    const second = normalizeChannelName(first);
    expect(first).toBe(second);
  });
});
