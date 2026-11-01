/**
 * Android : le lecteur libmpv ne lit jamais un flux HTTPS sans vérifier son certificat.
 * Les tests Kotlin ne tournent pas partout : ce garde-fou lit le code du moteur.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { classifyNativeError } from '../services/player/playbackErrors';

const BRIDGE = resolve(__dirname, '../../src-tauri/plugins/tauri-plugin-nyx-android/android/src/main/java/com/nyxplayer/nativebridge');
const engine = readFileSync(resolve(BRIDGE, 'MpvEngine.kt'), 'utf8');
const policy = readFileSync(resolve(BRIDGE, 'PlaybackPolicy.kt'), 'utf8');

describe('vérification HTTPS du lecteur Android', () => {
  it('la vérification des certificats n\'est jamais coupée', () => {
    expect(engine).toContain('setOptionString("tls-verify", "yes")');
    expect(engine).not.toMatch(/"tls-verify",\s*"no"/);
  });

  it('un flux HTTPS sans certificats est refusé avec un code que l\'interface reconnaît', () => {
    const code = /const val TLS_CA_UNAVAILABLE = "([A-Z_]+)"/.exec(policy)?.[1];
    expect(code).toBeDefined();
    expect(classifyNativeError(code)).toBe('tls_unavailable');
    expect(engine).toContain('errorPayload(id, PlaybackPolicy.TLS_CA_UNAVAILABLE)');
  });

  // Un flux http redirigé vers https sans certificats donne le même message, pas « connexion impossible »
  it('un échec TLS sans certificats pendant l\'ouverture choisit le code de connexion sécurisée', () => {
    expect(engine).toMatch(/PlaybackPolicy\.isTlsFailure\(line\)\) tlsFailed = true/);
    expect(engine).toMatch(/loadFailureCode\(tlsFailed, certificatesAvailable = caFile != null\)/);
    expect(engine).toMatch(/errorPayload\(id, code, status\)/);
  });
});
