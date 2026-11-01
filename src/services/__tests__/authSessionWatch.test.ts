import { describe, it, expect, beforeEach, vi } from 'vitest';
import { clearSignOutRequested, markSignOutRequested, resetAuthSessionWatch, trackAuthEvent, wasSessionLost } from '../authSessionWatch';

describe('authSessionWatch', () => {
  beforeEach(() => {
    resetAuthSessionWatch();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  it('déconnexion demandée : pas de « session expirée »', () => {
    markSignOutRequested();
    trackAuthEvent('SIGNED_OUT');
    expect(wasSessionLost()).toBe(false);
  });

  it('déconnexion non demandée (jeton refusé) : session perdue', () => {
    trackAuthEvent('SIGNED_OUT');
    expect(wasSessionLost()).toBe(true);
  });

  it('la demande ne vaut que pour une déconnexion', () => {
    markSignOutRequested();
    trackAuthEvent('SIGNED_OUT');
    trackAuthEvent('SIGNED_OUT');
    expect(wasSessionLost()).toBe(true);
  });

  it('reconnexion : l\'avis disparaît', () => {
    trackAuthEvent('SIGNED_OUT');
    trackAuthEvent('SIGNED_IN');
    expect(wasSessionLost()).toBe(false);
  });

  it('renouvellement ou session initiale : aucun changement', () => {
    trackAuthEvent('SIGNED_OUT');
    trackAuthEvent('INITIAL_SESSION');
    trackAuthEvent('TOKEN_REFRESHED');
    expect(wasSessionLost()).toBe(true);
  });

  it('déconnexion demandée mais ratée (hors ligne) : une perte ultérieure reste signalée', () => {
    markSignOutRequested();
    clearSignOutRequested();
    trackAuthEvent('SIGNED_OUT');
    expect(wasSessionLost()).toBe(true);
  });
});
