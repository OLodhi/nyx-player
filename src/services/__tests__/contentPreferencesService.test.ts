/**
 * Tests pour contentPreferencesService.ts : préférences par contenu (source, saison, vitesse, pistes).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockDb = {
  select: vi.fn<(sql: string, params?: unknown[]) => Promise<unknown[]>>(),
  execute: vi.fn<(sql: string, params?: unknown[]) => Promise<void>>(),
};

vi.mock('../dbCore', () => ({
  getDatabase: vi.fn(() => Promise.resolve(mockDb)),
}));

import {
  getPreferredSource,
  setPreferredSource,
  getLastSeason,
  setLastSeason,
  getPlaybackSpeed,
  setPlaybackSpeed,
  seriesTracksKey,
  getSavedTracks,
  saveAudioPreference,
  saveSubPreference,
} from '../contentPreferencesService';
import { getDatabase } from '../dbCore';

beforeEach(() => {
  vi.clearAllMocks();
  mockDb.select.mockResolvedValue([]);
  mockDb.execute.mockResolvedValue(undefined);
});

describe('contentPreferencesService - lecture', () => {
  it('interroge la table avec le type, l\'identifiant et la clé', async () => {
    await getPreferredSource('movie', 603);
    expect(mockDb.select).toHaveBeenCalledWith(
      expect.stringContaining('FROM content_preferences'),
      ['movie', '603', 'preferred_source']
    );
  });

  it('renvoie null quand aucune préférence n\'est enregistrée', async () => {
    expect(await getPreferredSource('series', 1)).toBeNull();
  });

  it('convertit la source préférée en nombre', async () => {
    mockDb.select.mockResolvedValueOnce([{ value: '4242' }]);
    expect(await getPreferredSource('movie', 1)).toBe(4242);
  });

  it('renvoie null si la source préférée n\'est pas numérique', async () => {
    mockDb.select.mockResolvedValueOnce([{ value: 'abc' }]);
    expect(await getPreferredSource('movie', 1)).toBeNull();
  });

  it('renvoie null et ne lève rien si la base échoue', async () => {
    vi.mocked(getDatabase).mockRejectedValueOnce(new Error('base fermée'));
    await expect(getPreferredSource('movie', 1)).resolves.toBeNull();
  });

  it('renvoie null si la requête SQL échoue', async () => {
    mockDb.select.mockRejectedValueOnce(new Error('SQL'));
    await expect(getLastSeason('tmdb_1')).resolves.toBeNull();
  });
});

describe('contentPreferencesService - saison', () => {
  it('lit la dernière saison de la série', async () => {
    mockDb.select.mockResolvedValueOnce([{ value: '3' }]);
    expect(await getLastSeason('tmdb_10')).toBe(3);
    expect(mockDb.select).toHaveBeenCalledWith(expect.any(String), ['series', 'tmdb_10', 'last_season']);
  });

  it.each(['0', '-2', 'x'])('rejette la saison invalide "%s"', async (value) => {
    mockDb.select.mockResolvedValueOnce([{ value }]);
    expect(await getLastSeason('9')).toBeNull();
  });

  it('enregistre la saison sous forme de texte', async () => {
    await setLastSeason('tmdb_10', 2);
    const [sql, params] = mockDb.execute.mock.calls[0];
    expect(sql).toContain('ON CONFLICT(content_type, identifier, key)');
    expect(params?.slice(0, 4)).toEqual(['series', 'tmdb_10', 'last_season', '2']);
    expect(typeof params?.[4]).toBe('number');
  });
});

describe('contentPreferencesService - source et vitesse', () => {
  it('enregistre la source préférée', async () => {
    await setPreferredSource('movie', 603, 77);
    expect(mockDb.execute.mock.calls[0][1]?.slice(0, 4)).toEqual(['movie', '603', 'preferred_source', '77']);
  });

  it('lit une vitesse décimale', async () => {
    mockDb.select.mockResolvedValueOnce([{ value: '1.5' }]);
    expect(await getPlaybackSpeed('55')).toBe(1.5);
    expect(mockDb.select).toHaveBeenCalledWith(expect.any(String), ['player', '55', 'playback_speed']);
  });

  it.each(['0', '-1', 'rapide'])('rejette la vitesse invalide "%s"', async (value) => {
    mockDb.select.mockResolvedValueOnce([{ value }]);
    expect(await getPlaybackSpeed('55')).toBeNull();
  });

  it('enregistre la vitesse', async () => {
    await setPlaybackSpeed('55', 1.25);
    expect(mockDb.execute.mock.calls[0][1]?.slice(0, 4)).toEqual(['player', '55', 'playback_speed', '1.25']);
  });

  it('avale l\'erreur d\'écriture sans la propager', async () => {
    mockDb.execute.mockRejectedValueOnce(new Error('disque plein'));
    await expect(setPlaybackSpeed('55', 2)).resolves.toBeUndefined();
  });
});

describe('contentPreferencesService - pistes', () => {
  it('préfixe la clé des pistes d\'une série', () => {
    expect(seriesTracksKey(12)).toBe('series-12');
  });

  it('décode les pistes enregistrées', async () => {
    mockDb.select.mockResolvedValueOnce([{ value: JSON.stringify({ preferredAudio: { lang: 'fr' } }) }]);
    expect(await getSavedTracks('1')).toEqual({ preferredAudio: { lang: 'fr' } });
  });

  it('renvoie null si le JSON est corrompu', async () => {
    mockDb.select.mockResolvedValueOnce([{ value: '{pas du json' }]);
    expect(await getSavedTracks('1')).toBeNull();
  });

  it('fusionne l\'audio sans toucher aux sous-titres existants', async () => {
    mockDb.select.mockResolvedValueOnce([
      { value: JSON.stringify({ preferredSub: { lang: 'en' }, subDisabled: false }) },
    ]);
    await saveAudioPreference('1', { lang: 'fr', title: 'VF' });
    const saved = JSON.parse(String(mockDb.execute.mock.calls[0][1]?.[3]));
    expect(saved).toEqual({
      preferredSub: { lang: 'en' },
      subDisabled: false,
      preferredAudio: { lang: 'fr', title: 'VF' },
    });
  });

  it('fusionne les sous-titres sans toucher à l\'audio existant', async () => {
    mockDb.select.mockResolvedValueOnce([{ value: JSON.stringify({ preferredAudio: { lang: 'fr' } }) }]);
    await saveSubPreference('1', null, true);
    const saved = JSON.parse(String(mockDb.execute.mock.calls[0][1]?.[3]));
    expect(saved).toEqual({ preferredAudio: { lang: 'fr' }, preferredSub: null, subDisabled: true });
  });

  it('crée l\'enregistrement quand rien n\'existe encore', async () => {
    await saveAudioPreference('9', null);
    const saved = JSON.parse(String(mockDb.execute.mock.calls[0][1]?.[3]));
    expect(saved).toEqual({ preferredAudio: null });
    expect(mockDb.execute.mock.calls[0][1]?.[2]).toBe('audio_sub_tracks');
  });
});
