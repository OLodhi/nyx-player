/**
 * devLog : traces détaillées activables à la main (console F12). Elles
 * masquent les identifiants Xtream comme le journal normal (logger.ts), message et détails compris.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { devLog } from '../devLog';

describe('devLog', () => {
  const spy = vi.spyOn(console, 'log').mockImplementation(() => {});

  beforeEach(() => {
    spy.mockClear();
    localStorage.setItem('devlog_enabled', 'true');
  });
  afterEach(() => localStorage.clear());

  it('n\'écrit rien quand il est éteint', () => {
    localStorage.clear();
    devLog('player', 'http://provider.example/live/john/secret/1.ts');
    expect(spy).not.toHaveBeenCalled();
  });

  it('masque les identifiants dans le message et dans les détails', () => {
    devLog('player', 'Lecture http://provider.example:8080/live/john/secret/1.ts', {
      url: 'http://provider.example/player_api.php?username=john&password=secret',
      nested: { list: ['http://john:secret@provider.example/get.php'] },
    }, 'http://provider.example/movie/john/secret/2.mkv');
    expect(spy).toHaveBeenCalledTimes(1);
    const written = JSON.stringify(spy.mock.calls[0]);
    expect(written).not.toMatch(/john|secret/);
    expect(written).toContain('/live/***/***/1.ts');
    expect(written).toContain('[PLAYER]');
  });
});
