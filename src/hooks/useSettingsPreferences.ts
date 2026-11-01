import { useState, useCallback, useEffect } from 'react';
import {
  getHomePage,
  setHomePage,
  type HomePageOption,
  isBingeModeEnabled,
  setBingeMode,
  getBingeCountdown,
  setBingeCountdown,
  isGeekStatsEnabled,
  setGeekStats,
  getDnsProvider,
  setDnsProvider,
  type DnsProvider,
  getDashboardDefaultMode,
  setDashboardDefaultMode,
  type DashboardDefaultMode,
  isEpgEnabled,
  setEpgEnabled,
} from '../services/preferencesService';
import {
  isHardwareAccelerationEnabled,
  setHardwareAcceleration,
} from '../services/appSettingsService';
import { warnOnReject } from '../utils/warnOnReject';

// ============================================================================
// HOOK
// ============================================================================
export function useSettingsPreferences() {
  const [homePage, setHomePageState] = useState<HomePageOption>(() => getHomePage());
  const [bingeMode, setBingeModeState] = useState(() => isBingeModeEnabled());
  const [bingeCountdown, setBingeCountdownState] = useState(() => getBingeCountdown());
  const [geekStats, setGeekStatsState] = useState(() => isGeekStatsEnabled());
  const [dnsProvider, setDnsProviderState] = useState<DnsProvider>(() => getDnsProvider());
  const [dashboardDefaultMode, setDashboardDefaultModeState] = useState<DashboardDefaultMode>(() => getDashboardDefaultMode());
  const [epgEnabled, setEpgEnabledState] = useState(() => isEpgEnabled());

  // Hardware acceleration — async init (reads from Rust JSON, not SQLite)
  const [hwAccel, setHwAccelState] = useState<boolean>(true);
  const [hwAccelLoaded, setHwAccelLoaded] = useState(false);

  useEffect(() => {
    isHardwareAccelerationEnabled()
      .then((val) => setHwAccelState(val))
      // Lecture en échec : l'interrupteur reste utilisable avec la valeur par défaut (activée)
      .catch(warnOnReject('SettingsPreferences'))
      .finally(() => setHwAccelLoaded(true));
  }, []);

  const handleHomePageChange = useCallback((value: HomePageOption) => {
    setHomePageState(value);
    void setHomePage(value);
  }, []);

  const handleBingeModeChange = useCallback((checked: boolean) => {
    setBingeModeState(checked);
    void setBingeMode(checked);
  }, []);

  const handleBingeCountdownChange = useCallback((value: number) => {
    setBingeCountdownState(value);
    void setBingeCountdown(value);
  }, []);

  const handleGeekStatsChange = useCallback((checked: boolean) => {
    setGeekStatsState(checked);
    void setGeekStats(checked);
  }, []);

  const handleDnsProviderChange = useCallback((value: DnsProvider) => {
    setDnsProviderState(value);
    void setDnsProvider(value);
  }, []);

  const handleDashboardDefaultModeChange = useCallback((value: DashboardDefaultMode) => {
    setDashboardDefaultModeState(value);
    void setDashboardDefaultMode(value);
  }, []);

  const handleEpgEnabledChange = useCallback((enabled: boolean) => {
    setEpgEnabledState(enabled);
    void setEpgEnabled(enabled);
  }, []);

  /**
   * Toggle hardware acceleration.
   * Writes to settings.json but does NOT restart — the caller must
   * show a ConfirmModal and call relaunch() if the user agrees.
   */
  const handleHwAccelChange = useCallback(async (enabled: boolean) => {
    await setHardwareAcceleration(enabled);
    setHwAccelState(enabled);
  }, []);

  return {
    homePage,
    bingeMode,
    bingeCountdown,
    geekStats,
    dnsProvider,
    dashboardDefaultMode,
    hwAccel,
    hwAccelLoaded,
    epgEnabled,
    handleHomePageChange,
    handleBingeModeChange,
    handleBingeCountdownChange,
    handleGeekStatsChange,
    handleDnsProviderChange,
    handleDashboardDefaultModeChange,
    handleHwAccelChange,
    handleEpgEnabledChange,
  };
}
