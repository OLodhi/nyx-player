/**
 * Tests du pont d'audit (auditBridge.tsx) : écran forcé « appScreen », lectures seules de la
 * version 2 pour le banc de tests automatiques.
 *
 * Le pont n'existe que dans la version d'audit (VITE_AUDIT=1) : le module est rechargé avec la
 * variable posée. Hors de cette version, useAuditScreen vaut toujours null.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { act, render, renderHook } from '@testing-library/react';

const resetAll = vi.fn();

vi.mock('../../contexts/NavigationContext', () => ({
  useNavigation: () => ({ activeTab: 'dashboard', selectedMovie: null, selectedSeries: null, categoryDetail: null }),
}));

vi.mock('../../contexts/DevOverrideContext', () => ({
  useDevOverrides: () => ({ overrides: { loginPage: { forceMode: null } }, resetAll }),
}));

// État des contextes lu par le pont v2, modifiable par test
const etat = vi.hoisted(() => ({
  credentials: null as null | { host: string; username: string; password: string },
  activeProfileId: null as null | string,
  user: null as null | { email: string },
  currentlyPlaying: null as unknown,
  playbackError: null as null | { kind: string },
  proprietes: {} as Record<string, unknown>,
  tables: {} as Record<string, number>,
  requetes: [] as string[],
  baseFermee: false,
}));

vi.mock('../../contexts/SessionContext', () => ({ useSession: () => ({ credentials: etat.credentials, activeProfileId: etat.activeProfileId }) }));
vi.mock('../../contexts/SupabaseAuthContext', () => ({ useSupabaseAuth: () => ({ user: etat.user }) }));
vi.mock('../../contexts/PlayerContext', () => ({
  usePlayer: () => ({ currentlyPlaying: etat.currentlyPlaying, playbackError: etat.playbackError }),
}));
vi.mock('../../services/player/mpvApi', () => ({
  getProperty: vi.fn(async (name: string) => {
    if (!(name in etat.proprietes)) throw new Error('propriété indisponible');
    return etat.proprietes[name];
  }),
}));
vi.mock('../bancAdresses', async (importOriginal) => {
  const reel = await importOriginal<typeof import('../bancAdresses')>();
  return {
    ...reel,
    tentativesLecture: () => [{ quand: '2026-09-30T12:00:00.000Z', cible: 'autre', acceptee: false }],
  };
});

vi.mock('../../services/dbCore', () => ({
  getOpenDatabase: () => (etat.baseFermee ? null : {
    select: async (sql: string) => {
      etat.requetes.push(sql);
      const table = /FROM (\w+)$/.exec(sql)?.[1] ?? '';
      if (!(table in etat.tables)) throw new Error('no such table');
      return [{ n: etat.tables[table] }];
    },
  }),
}));

async function loadBridge(audit: boolean) {
  vi.resetModules();
  vi.stubEnv('VITE_AUDIT', audit ? '1' : '');
  return import('../auditBridge');
}

afterEach(() => {
  vi.unstubAllEnvs();
  delete window.__nyxAudit;
  Object.assign(etat, { credentials: null, activeProfileId: null, user: null, currentlyPlaying: null, playbackError: null, proprietes: {}, tables: {}, requetes: [], baseFermee: false });
});

describe('auditBridge — écran forcé', () => {
  it('affiche puis retire la connexion au compte et l\'ajout du fournisseur', async () => {
    const { AuditBridge, useAuditScreen } = await loadBridge(true);
    render(<AuditBridge />);
    const { result } = renderHook(() => useAuditScreen());
    expect(result.current).toBeNull();

    act(() => { expect(window.__nyxAudit?.set('appScreen', 'show', 'account')).toBe(true); });
    expect(result.current).toBe('account');
    act(() => { window.__nyxAudit?.set('appScreen', 'show', 'provider'); });
    expect(result.current).toBe('provider');
    expect(window.__nyxAudit?.list().appScreen).toEqual({ show: 'provider' });
    act(() => { window.__nyxAudit?.set('appScreen', 'show', null); });
    expect(result.current).toBeNull();
  });

  it('refuse un écran ou une clé inconnus', async () => {
    const { AuditBridge, useAuditScreen } = await loadBridge(true);
    render(<AuditBridge />);
    const { result } = renderHook(() => useAuditScreen());
    expect(window.__nyxAudit?.set('appScreen', 'show', 'dashboard')).toBe(false);
    expect(window.__nyxAudit?.set('appScreen', 'screen', 'account')).toBe(false);
    expect(result.current).toBeNull();
  });

  it('la remise à zéro retire aussi l\'écran forcé', async () => {
    const { AuditBridge, useAuditScreen } = await loadBridge(true);
    render(<AuditBridge />);
    const { result } = renderHook(() => useAuditScreen());
    act(() => { window.__nyxAudit?.set('appScreen', 'show', 'account'); });
    act(() => { window.__nyxAudit?.reset(); });
    expect(result.current).toBeNull();
    expect(resetAll).toHaveBeenCalled();
  });

  it('hors de la version d\'audit, aucun écran forcé', async () => {
    const { useAuditScreen, AUDIT_BRIDGE_ENABLED } = await loadBridge(false);
    expect(AUDIT_BRIDGE_ENABLED).toBe(false);
    const { result } = renderHook(() => useAuditScreen());
    expect(result.current).toBeNull();
  });
});

describe('auditBridge v2 — lectures seules du banc', () => {
  it('passe en version 2 et garde l\'existant', async () => {
    const { AuditBridge } = await loadBridge(true);
    render(<AuditBridge />);
    expect(window.__nyxAudit?.version).toBe(2);
    expect(window.__nyxAudit?.state().tab).toBe('dashboard');
  });

  it('source : nature de la source active, jamais son adresse', async () => {
    const { AuditBridge } = await loadBridge(true);
    render(<AuditBridge />);
    expect(window.__nyxAudit?.source()).toBeNull();
    etat.credentials = { host: 'http://10.0.2.2:8765', username: 'banc', password: 'banc' };
    render(<AuditBridge />);
    expect(window.__nyxAudit?.source()).toBe('faux');
    etat.credentials = { host: 'http://10.0.2.2:8790', username: 'u', password: 'p' };
    render(<AuditBridge />);
    expect(window.__nyxAudit?.source()).toBe('relais');
    etat.credentials = { host: 'http://fournisseur.exemple.invalid:8080', username: 'u', password: 'p' };
    render(<AuditBridge />);
    expect(window.__nyxAudit?.source()).toBe('autre');
  });

  it('lecteur fermé : rien n\'est demandé au lecteur', async () => {
    const { AuditBridge } = await loadBridge(true);
    render(<AuditBridge />);
    await expect(window.__nyxAudit!.lecteur()).resolves.toEqual({
      ouvert: false, position: null, duree: null, pause: null, muet: null, pisteAudio: null, sousTitres: null, erreur: null,
    });
  });

  it('lecteur ouvert : position, durée, pause, sourdine, pistes et erreur, sans l\'adresse du flux', async () => {
    etat.currentlyPlaying = { url: 'http://127.0.0.1:8765/movie/banc/banc/1.mp4', title: 'Film' };
    etat.playbackError = { kind: 'connection_limit' };
    etat.proprietes = { 'time-pos': 12.5, duration: 60, pause: false, mute: true, aid: 2 };
    const { AuditBridge } = await loadBridge(true);
    render(<AuditBridge />);
    const l = await window.__nyxAudit!.lecteur();
    expect(l).toEqual({ ouvert: true, position: 12.5, duree: 60, pause: false, muet: true, pisteAudio: 2, sousTitres: null, erreur: 'connection_limit' });
    expect(JSON.stringify(l)).not.toContain('8765');
  });

  it('lectures : les tentatives vues par le verrou, sans adresse', async () => {
    const { AuditBridge } = await loadBridge(true);
    render(<AuditBridge />);
    expect(window.__nyxAudit?.lectures()).toEqual([{ quand: '2026-09-30T12:00:00.000Z', cible: 'autre', acceptee: false }]);
  });

  it('compte : empreinte SHA-256 de l\'e-mail en minuscules, jamais l\'e-mail', async () => {
    const { AuditBridge } = await loadBridge(true);
    render(<AuditBridge />);
    await expect(window.__nyxAudit!.compte()).resolves.toEqual({ connecte: false, empreinte: null });
    etat.user = { email: ' Test@Exemple.Invalid ' };
    render(<AuditBridge />);
    const c = await window.__nyxAudit!.compte();
    // echo -n "test@exemple.invalid" | sha256sum
    expect(c).toEqual({ connecte: true, empreinte: '8c1066f14d9ed77be4d097690c4c60020f5d0deec4f9e0f0f3387615619a3520' });
    expect(JSON.stringify(c)).not.toContain('exemple');
  });

  it('profil : l\'identifiant du profil actif (jamais son nom), null sans profil', async () => {
    const { AuditBridge } = await loadBridge(true);
    render(<AuditBridge />);
    expect(window.__nyxAudit!.profil()).toBeNull();
    etat.activeProfileId = '6f1c1d2e-0000-4000-8000-000000000001';
    render(<AuditBridge />);
    expect(window.__nyxAudit!.profil()).toBe('6f1c1d2e-0000-4000-8000-000000000001');
  });

  it('catalogue : nombre de chaînes, films et séries de la base locale, en lecture seule', async () => {
    const { AuditBridge } = await loadBridge(true);
    render(<AuditBridge />);
    etat.tables = { live: 10, movies: 11 };
    await expect(window.__nyxAudit!.catalogue()).resolves.toEqual({ chaines: 10, films: 11, series: null });
    expect(etat.requetes.every((q) => /^SELECT COUNT\(\*\) AS n FROM (live|movies|series)$/.test(q))).toBe(true);
  });

  it('catalogue : base pas encore ouverte par l\'app, rien n\'est ouvert ni lu', async () => {
    const { AuditBridge } = await loadBridge(true);
    render(<AuditBridge />);
    etat.baseFermee = true;
    await expect(window.__nyxAudit!.catalogue()).resolves.toEqual({ chaines: null, films: null, series: null });
    expect(etat.requetes).toEqual([]);
  });
});
