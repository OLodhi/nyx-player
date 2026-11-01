/**
 * Décisions de la mise à jour Android (fonctions pures) : quelle version est plus récente, quelle
 * entrée du manifeste est acceptée, et le manifeste du dépôt ne propose rien avant la sortie.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { findUpdate, isNewerVersion, parseVersion, selectUpdate } from '../androidUpdate';

const SHA = 'AB'.repeat(32);
const entry = (extra: Record<string, unknown> = {}) => ({
  url: 'https://releases.nyxplayer.app/nyx-player-armv7-v0.8.1.apk',
  sha256: SHA,
  size: 50_000_000,
  ...extra,
});
const manifest = (armv7: unknown, version: unknown = '0.8.1') => ({ version, apks: { armv7 } });
const app = { packageName: 'com.nyxplayer.app', versionName: '0.8.0', abi: 'armv7' as const };

describe('versions', () => {
  it('compare nombre par nombre, pas comme du texte', () => {
    expect(isNewerVersion('0.10.0', '0.9.9')).toBe(true);
    expect(isNewerVersion('0.8.1', '0.8.0')).toBe(true);
    expect(isNewerVersion('1.0.0', '0.99.99')).toBe(true);
    expect(isNewerVersion('0.8.0', '0.8.0')).toBe(false);
    expect(isNewerVersion('0.7.6', '0.8.0')).toBe(false);
  });

  it('format inattendu : jamais « plus récent »', () => {
    expect(parseVersion('0.8')).toBeNull();
    expect(parseVersion('0.8.1-beta')).toBeNull();
    expect(isNewerVersion('9.9.9-beta', '0.8.0')).toBe(false);
    expect(isNewerVersion('0.9.0', '')).toBe(false);
  });
});

describe('entrée du manifeste', () => {
  it('entrée complète sur releases.nyxplayer.app : acceptée, empreinte en minuscules', () => {
    expect(selectUpdate(manifest(entry()), 'armv7')).toEqual({
      version: '0.8.1',
      url: 'https://releases.nyxplayer.app/nyx-player-armv7-v0.8.1.apk',
      sha256: SHA.toLowerCase(),
      size: 50_000_000,
    });
  });

  it('version entourée d\'espaces : rendue sans, car le plugin compare celle de l\'APK au caractère près', () => {
    expect(selectUpdate(manifest(entry(), ' 0.8.1 '), 'armv7')?.version).toBe('0.8.1');
  });

  it.each([
    ['autre site', { url: 'https://evil.example/nyx.apk' }],
    ['http', { url: 'http://releases.nyxplayer.app/nyx.apk' }],
    ['sous-domaine piégé', { url: 'https://releases.nyxplayer.app.evil.example/nyx.apk' }],
    ['empreinte courte', { sha256: 'abc' }],
    ['empreinte pas hexadécimale', { sha256: 'zz'.repeat(32) }],
    ['taille nulle', { size: 0 }],
    ['taille décimale', { size: 12.5 }],
    ['taille démesurée', { size: 400 * 1024 * 1024 }],
    ['taille en texte', { size: '1000' }],
  ])('refusée : %s', (_label, extra) => {
    expect(selectUpdate(manifest(entry(extra)), 'armv7')).toBeNull();
  });

  it('pas d\'APK pour ce processeur, version illisible, manifeste vide : rien', () => {
    expect(selectUpdate(manifest(entry()), 'arm64')).toBeNull();
    expect(selectUpdate(manifest(entry(), '0.8'), 'armv7')).toBeNull();
    expect(selectUpdate(manifest(entry(), 81), 'armv7')).toBeNull();
    expect(selectUpdate(null, 'armv7')).toBeNull();
    expect(selectUpdate([], 'armv7')).toBeNull();
    expect(selectUpdate({ version: '0.8.1', apks: [] }, 'armv7')).toBeNull();
  });

  it('manifeste de test (versions d\'audit) : APK servi par le PC accepté, mais jamais hors http(s)', () => {
    const local = manifest(entry({ url: 'http://10.0.2.2:8000/nyx.apk' }));
    expect(selectUpdate(local, 'armv7')).toBeNull();
    expect(selectUpdate(local, 'armv7', true)?.url).toBe('http://10.0.2.2:8000/nyx.apk');
    expect(selectUpdate(manifest(entry({ url: 'file:///sdcard/nyx.apk' })), 'armv7', true)).toBeNull();
  });
});

describe('mise à jour à proposer', () => {
  it('seulement à la vraie app, de son processeur, et plus récente', () => {
    expect(findUpdate(app, manifest(entry()))?.version).toBe('0.8.1');
    expect(findUpdate({ ...app, packageName: 'com.nyxplayer.app.banc' }, manifest(entry()))).toBeNull();
    expect(findUpdate({ ...app, abi: null }, manifest(entry()))).toBeNull();
    expect(findUpdate({ ...app, versionName: '0.8.1' }, manifest(entry()))).toBeNull();
  });

  it('le manifeste du dépôt (web/updates/android.json) est lisible par l\'app, chaque APK compris', () => {
    // Avant la sortie : version 0.0.0 sans APK (rien n'est proposé) ; ensuite, écrit par le script des APK
    const committed = JSON.parse(readFileSync(resolve(__dirname, '../../../web/updates/android.json'), 'utf8')) as {
      version: string;
      apks: Record<string, unknown>;
    };
    expect(parseVersion(committed.version)).not.toBeNull();
    for (const abi of Object.keys(committed.apks)) {
      expect(['arm64', 'armv7']).toContain(abi);
      expect(selectUpdate(committed, abi as 'arm64' | 'armv7')).not.toBeNull();
    }
  });
});
