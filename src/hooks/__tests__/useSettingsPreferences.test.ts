/**
 * Tests pour useSettingsPreferences.ts
 * Vérifie : valeurs initiales, enregistrement de chaque réglage, accélération matérielle.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';

vi.mock('../../services/preferencesService', () => ({
  getHomePage: vi.fn(() => 'dashboard'),
  setHomePage: vi.fn().mockResolvedValue(undefined),
  isBingeModeEnabled: vi.fn(() => true),
  setBingeMode: vi.fn().mockResolvedValue(undefined),
  getBingeCountdown: vi.fn(() => 10),
  setBingeCountdown: vi.fn().mockResolvedValue(undefined),
  isGeekStatsEnabled: vi.fn(() => false),
  setGeekStats: vi.fn().mockResolvedValue(undefined),
  getDnsProvider: vi.fn(() => 'system'),
  setDnsProvider: vi.fn().mockResolvedValue(undefined),
  getDashboardDefaultMode: vi.fn(() => 'all'),
  setDashboardDefaultMode: vi.fn().mockResolvedValue(undefined),
  isEpgEnabled: vi.fn(() => true),
  setEpgEnabled: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../services/appSettingsService', () => ({
  isHardwareAccelerationEnabled: vi.fn(),
  setHardwareAcceleration: vi.fn(),
}));

import { useSettingsPreferences } from '../useSettingsPreferences';
import * as prefs from '../../services/preferencesService';
import { isHardwareAccelerationEnabled, setHardwareAcceleration } from '../../services/appSettingsService';

describe('useSettingsPreferences', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(isHardwareAccelerationEnabled).mockResolvedValue(true);
    vi.mocked(setHardwareAcceleration).mockResolvedValue(undefined);
  });

  describe('Valeurs initiales', () => {
    it('reprend les réglages enregistrés', async () => {
      const { result } = renderHook(() => useSettingsPreferences());
      await waitFor(() => expect(result.current.hwAccelLoaded).toBe(true));
      expect(result.current.homePage).toBe('dashboard');
      expect(result.current.bingeMode).toBe(true);
      expect(result.current.bingeCountdown).toBe(10);
      expect(result.current.geekStats).toBe(false);
      expect(result.current.dnsProvider).toBe('system');
      expect(result.current.dashboardDefaultMode).toBe('all');
      expect(result.current.epgEnabled).toBe(true);
    });
  });

  describe('Enregistrement des réglages', () => {
    it('met à jour l\'affichage et enregistre la page d\'accueil', async () => {
      const { result } = renderHook(() => useSettingsPreferences());
      await waitFor(() => expect(result.current.hwAccelLoaded).toBe(true));
      act(() => result.current.handleHomePageChange('movies' as never));
      expect(result.current.homePage).toBe('movies');
      expect(prefs.setHomePage).toHaveBeenCalledWith('movies');
    });

    it('met à jour et enregistre le mode enchaînement', async () => {
      const { result } = renderHook(() => useSettingsPreferences());
      await waitFor(() => expect(result.current.hwAccelLoaded).toBe(true));
      act(() => result.current.handleBingeModeChange(false));
      expect(result.current.bingeMode).toBe(false);
      expect(prefs.setBingeMode).toHaveBeenCalledWith(false);
    });

    it('met à jour et enregistre le compte à rebours', async () => {
      const { result } = renderHook(() => useSettingsPreferences());
      await waitFor(() => expect(result.current.hwAccelLoaded).toBe(true));
      act(() => result.current.handleBingeCountdownChange(5));
      expect(result.current.bingeCountdown).toBe(5);
      expect(prefs.setBingeCountdown).toHaveBeenCalledWith(5);
    });

    it('met à jour et enregistre les statistiques techniques', async () => {
      const { result } = renderHook(() => useSettingsPreferences());
      await waitFor(() => expect(result.current.hwAccelLoaded).toBe(true));
      act(() => result.current.handleGeekStatsChange(true));
      expect(result.current.geekStats).toBe(true);
      expect(prefs.setGeekStats).toHaveBeenCalledWith(true);
    });

    it('met à jour et enregistre le fournisseur DNS', async () => {
      const { result } = renderHook(() => useSettingsPreferences());
      await waitFor(() => expect(result.current.hwAccelLoaded).toBe(true));
      act(() => result.current.handleDnsProviderChange('cloudflare' as never));
      expect(result.current.dnsProvider).toBe('cloudflare');
      expect(prefs.setDnsProvider).toHaveBeenCalledWith('cloudflare');
    });

    it('met à jour et enregistre le mode par défaut du tableau de bord', async () => {
      const { result } = renderHook(() => useSettingsPreferences());
      await waitFor(() => expect(result.current.hwAccelLoaded).toBe(true));
      act(() => result.current.handleDashboardDefaultModeChange('movies' as never));
      expect(result.current.dashboardDefaultMode).toBe('movies');
      expect(prefs.setDashboardDefaultMode).toHaveBeenCalledWith('movies');
    });

    it('met à jour et enregistre le guide des programmes', async () => {
      const { result } = renderHook(() => useSettingsPreferences());
      await waitFor(() => expect(result.current.hwAccelLoaded).toBe(true));
      act(() => result.current.handleEpgEnabledChange(false));
      expect(result.current.epgEnabled).toBe(false);
      expect(prefs.setEpgEnabled).toHaveBeenCalledWith(false);
    });
  });

  describe('Accélération matérielle', () => {
    it('reprend la valeur lue et signale la fin du chargement', async () => {
      vi.mocked(isHardwareAccelerationEnabled).mockResolvedValue(false);
      const { result } = renderHook(() => useSettingsPreferences());
      expect(result.current.hwAccelLoaded).toBe(false);
      await waitFor(() => expect(result.current.hwAccelLoaded).toBe(true));
      expect(result.current.hwAccel).toBe(false);
    });

    it('reste activée par défaut quand la lecture échoue', async () => {
      vi.mocked(isHardwareAccelerationEnabled).mockRejectedValue(new Error('illisible'));
      const { result } = renderHook(() => useSettingsPreferences());
      await waitFor(() => expect(result.current.hwAccelLoaded).toBe(true));
      expect(result.current.hwAccel).toBe(true);
    });

    it('enregistre le changement avant de mettre l\'interrupteur à jour', async () => {
      const { result } = renderHook(() => useSettingsPreferences());
      await waitFor(() => expect(result.current.hwAccelLoaded).toBe(true));
      await act(async () => {
        await result.current.handleHwAccelChange(false);
      });
      expect(setHardwareAcceleration).toHaveBeenCalledWith(false);
      expect(result.current.hwAccel).toBe(false);
    });

    it('garde l\'ancienne valeur quand l\'enregistrement échoue', async () => {
      vi.mocked(setHardwareAcceleration).mockRejectedValue(new Error('écriture refusée'));
      const { result } = renderHook(() => useSettingsPreferences());
      await waitFor(() => expect(result.current.hwAccelLoaded).toBe(true));
      await act(async () => {
        await result.current.handleHwAccelChange(false).catch(() => undefined);
      });
      expect(result.current.hwAccel).toBe(true);
    });
  });
});
