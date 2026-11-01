// @vitest-environment node
// Garde-fou de publication (scripts/garde-publication.mjs) : une version publiée n'est jamais compilée
// en mode audit ou banc.
import { describe, it, expect } from 'vitest';
import { refusPublication } from '../garde-publication.mjs';

const SCRIPT_AUDIT = { NYX_VERSION_AUDIT: '1' };

describe('garde-fou de publication', () => {
  it('version normale : toujours admise, clé de signature comprise', () => {
    expect(refusPublication({ commande: 'build', vite: {}, processus: {} })).toBeNull();
    expect(refusPublication({ commande: 'build', vite: { VITE_AUDIT: '' }, processus: { TAURI_SIGNING_PRIVATE_KEY: 'x' } })).toBeNull();
  });

  it('versions d\'audit et du banc : admises depuis les scripts d\'audit', () => {
    expect(refusPublication({ commande: 'build', vite: { VITE_AUDIT: '1' }, processus: SCRIPT_AUDIT })).toBeNull();
    expect(refusPublication({ commande: 'build', vite: { VITE_AUDIT: '1', VITE_BANC: '1' }, processus: SCRIPT_AUDIT })).toBeNull();
  });

  it('VITE_AUDIT ou VITE_BANC oublié (terminal, .env.local) hors des scripts d\'audit : refusé', () => {
    expect(refusPublication({ commande: 'build', vite: { VITE_AUDIT: '1' }, processus: {} })).toMatch(/hors des scripts d'audit/);
    expect(refusPublication({ commande: 'build', vite: { VITE_AUDIT: '1', VITE_BANC: '1' }, processus: { NYX_VERSION_AUDIT: '0' } })).toMatch(/banc.*hors des scripts d'audit/);
  });

  it('manifeste de test des mises à jour Android : seulement dans une version d\'audit', () => {
    const maj = { VITE_ANDROID_UPDATE_MANIFEST: 'http://10.0.2.2:8000/android.json' };
    expect(refusPublication({ commande: 'build', vite: { VITE_AUDIT: '1', ...maj }, processus: SCRIPT_AUDIT })).toBeNull();
    // Oubliée dans un .env : une version normale est refusée, clé de signature ou non
    expect(refusPublication({ commande: 'build', vite: maj, processus: {} })).toMatch(/VITE_ANDROID_UPDATE_MANIFEST hors d'une version d'audit/);
    expect(refusPublication({ commande: 'build', vite: maj, processus: { TAURI_SIGNING_PRIVATE_KEY: 'x' } })).toMatch(/VITE_ANDROID_UPDATE_MANIFEST/);
    expect(refusPublication({ commande: 'build', vite: { VITE_ANDROID_UPDATE_MANIFEST: '' }, processus: {} })).toBeNull();
    // Serveur de développement : rien n'est publié
    expect(refusPublication({ commande: 'serve', vite: maj, processus: {} })).toBeNull();
  });

  it('variante « vrai lecteur » du banc : seulement avec VITE_BANC=1 et la valeur « reel »', () => {
    const banc = { VITE_AUDIT: '1', VITE_BANC: '1' };
    expect(refusPublication({ commande: 'build', vite: { ...banc, VITE_BANC_LECTEUR: 'reel' }, processus: SCRIPT_AUDIT })).toBeNull();
    // Oubliée seule (terminal, .env.local) : refusée, même dans une version normale
    expect(refusPublication({ commande: 'build', vite: { VITE_BANC_LECTEUR: 'reel' }, processus: {} })).toMatch(/sans VITE_BANC=1/);
    expect(refusPublication({ commande: 'build', vite: { VITE_AUDIT: '1', VITE_BANC_LECTEUR: 'reel' }, processus: SCRIPT_AUDIT })).toMatch(/sans VITE_BANC=1/);
    expect(refusPublication({ commande: 'build', vite: { ...banc, VITE_BANC_LECTEUR: 'oui' }, processus: SCRIPT_AUDIT })).toMatch(/ne vaut que « reel »/);
    // Empreinte et variante d'accord (variable oubliée dans un .env)
    const empreinte = (e) => ({ ...banc, VITE_AUDIT_BUILD: e });
    expect(refusPublication({ commande: 'build', vite: { ...empreinte('abc+lecteur+banc'), VITE_BANC_LECTEUR: 'reel' }, processus: SCRIPT_AUDIT })).toBeNull();
    expect(refusPublication({ commande: 'build', vite: empreinte('abc+banc'), processus: SCRIPT_AUDIT })).toBeNull();
    expect(refusPublication({ commande: 'build', vite: { ...empreinte('abc+banc'), VITE_BANC_LECTEUR: 'reel' }, processus: SCRIPT_AUDIT })).toMatch(/empreinte de la version et la variante/);
    expect(refusPublication({ commande: 'build', vite: empreinte('abc+lecteur+banc'), processus: SCRIPT_AUDIT })).toMatch(/empreinte de la version et la variante/);
  });

  it('clé de signature des mises à jour présente : refusé même depuis un script d\'audit, sans jamais la clé', () => {
    const r = refusPublication({ commande: 'build', vite: { VITE_AUDIT: '1' }, processus: { ...SCRIPT_AUDIT, TAURI_SIGNING_PRIVATE_KEY: 'cle-factice-secrete' } });
    expect(r).toMatch(/clé de signature/);
    expect(r).not.toContain('cle-factice-secrete');
  });

  it('VITE_BANC sans VITE_AUDIT : refusé', () => {
    expect(refusPublication({ commande: 'build', vite: { VITE_BANC: '1' }, processus: SCRIPT_AUDIT })).toMatch(/VITE_BANC=1 sans VITE_AUDIT=1/);
  });

  it('serveur de développement, Vitest, mode aperçu : pas concernés', () => {
    expect(refusPublication({ commande: 'serve', vite: { VITE_AUDIT: '1', VITE_BANC: '1' }, processus: {} })).toBeNull();
  });
});
