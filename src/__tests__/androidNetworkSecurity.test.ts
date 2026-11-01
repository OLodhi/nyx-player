/**
 * Android : le trafic en clair reste permis pour les fournisseurs IPTV (flux en http), mais pas pour
 * les services de Nyx.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ANDROID_MAIN = resolve(__dirname, '../../src-tauri/gen/android/app/src/main');
const manifest = readFileSync(resolve(ANDROID_MAIN, 'AndroidManifest.xml'), 'utf8');
const config = readFileSync(resolve(ANDROID_MAIN, 'res/xml/network_security_config.xml'), 'utf8');

/** Domaines de la section qui interdit le clair */
const strictDomains = (): string[] => {
  const section = /<domain-config cleartextTrafficPermitted="false">([\s\S]*?)<\/domain-config>/.exec(config)?.[1] ?? '';
  return [...section.matchAll(/<domain includeSubdomains="true">([^<]+)<\/domain>/g)].map((m) => m[1].trim());
};

describe('sécurité réseau Android', () => {
  it('le manifeste utilise la configuration réseau', () => {
    expect(manifest).toContain('android:networkSecurityConfig="@xml/network_security_config"');
  });

  it('le clair reste permis par défaut : flux IPTV en http', () => {
    expect(config).toContain('<base-config cleartextTrafficPermitted="true"');
  });

  it('Supabase, TMDB et le site de Nyx n\'acceptent que le https', () => {
    expect(strictDomains()).toEqual(expect.arrayContaining(['supabase.co', 'themoviedb.org', 'tmdb.org', 'nyxplayer.app']));
  });

  it('aucune autorité de certification ajoutée (certificats du système seulement)', () => {
    expect(config).not.toMatch(/trust-anchors|certificates src/);
  });
});
