/**
 * Tests : identifiants Xtream avec caractères spéciaux. Valeurs factices uniquement.
 */

import { describe, it, expect } from 'vitest';
import { encodeXtreamPathSegment, readM3uParam, safeContainerExtension } from '../xtreamCredentials';

describe('encodeXtreamPathSegment', () => {
  it('laisse inchangé un identifiant ordinaire (adresses existantes identiques)', () => {
    expect(encodeXtreamPathSegment('jean.dupont')).toBe('jean.dupont');
    expect(encodeXtreamPathSegment('Ab-12_x@y!&+=')).toBe('Ab-12_x@y!&+=');
  });

  it('encode les caractères qui cassent le chemin', () => {
    expect(encodeXtreamPathSegment('a/b?c#d e%f')).toBe('a%2Fb%3Fc%23d%20e%25f');
  });
});

describe('readM3uParam', () => {
  const link = (query: string) => new URL(`http://provider.example:8080/get.php?${query}`);

  it('garde un « + » littéral dans le mot de passe', () => {
    expect(readM3uParam(link('username=jean&password=ab+cd&type=m3u'), 'password')).toBe('ab+cd');
  });

  it('décode les séquences %XX (mot de passe avec & # espace)', () => {
    expect(readM3uParam(link('username=jean&password=a%26b%23c%20d'), 'password')).toBe('a&b#c d');
    expect(readM3uParam(link('username=je%2Ban&password=x'), 'username')).toBe('je+an');
  });

  it('rend la valeur brute si une séquence % est invalide', () => {
    expect(readM3uParam(link('username=jean&password=100%sur'), 'password')).toBe('100%sur');
  });

  it('rend une chaîne vide si le paramètre manque', () => {
    expect(readM3uParam(link('username=jean'), 'password')).toBe('');
  });
});

describe('safeContainerExtension', () => {
  it('garde une extension ordinaire', () => {
    for (const ext of ['ts', 'mkv', 'mp4', 'm3u8', 'MKV', 'webm']) expect(safeContainerExtension(ext)).toBe(ext);
  });

  it('garde une extension longue et retire un point initial', () => {
    // Certains fournisseurs annoncent « mpegts » ou « .mkv » : les remplacer par mp4 donnerait un 404
    expect(safeContainerExtension('mpegts')).toBe('mpegts');
    expect(safeContainerExtension('abcdefgh')).toBe('abcdefgh');
    expect(safeContainerExtension('.mkv')).toBe('mkv');
    expect(safeContainerExtension('.MP4')).toBe('MP4');
  });

  it('refuse ce qui changerait le chemin ou les paramètres du flux', () => {
    for (const ext of ['mkv/../x', 'ts?a=b', 'ts#x', 'm k v', '', '.', '..mkv', 'abcdefghi', '/mkv', null, undefined, 3]) {
      expect(safeContainerExtension(ext)).toBeUndefined();
    }
  });
});
