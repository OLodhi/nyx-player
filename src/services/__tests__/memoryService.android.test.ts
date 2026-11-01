/**
 * memoryService sur Android : la TV Android n'est pas un « téléphone » pour `isMobileDevice`, mais les
 * commandes de purge ne font rien hors Windows : aucun message natif ne doit partir.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mockInvoke = vi.fn();

vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => mockInvoke(...args),
}));

vi.mock('../../utils/devLog', () => ({
  devLog: vi.fn(),
}));

// TV Android : système android, mais pas un téléphone
vi.mock('../../utils/platform', () => ({
  isAndroid: () => true,
  isMobileDevice: () => false,
}));

describe('memoryService sur Android TV', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    mockInvoke.mockResolvedValue('ok');
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('ne lance aucune commande native après un défilement', async () => {
    const { requestMemoryPurge } = await import('../memoryService');
    requestMemoryPurge();
    await vi.advanceTimersByTimeAsync(1500);
    expect(mockInvoke).not.toHaveBeenCalled();
  });

  it('ne lance aucune commande native à un changement de page ni en lecture', async () => {
    const { forceMemoryPurge, enterPlayerMode, purgeInPlayerMode } = await import('../memoryService');
    forceMemoryPurge();
    await enterPlayerMode();
    await purgeInPlayerMode();
    await vi.advanceTimersByTimeAsync(1500);
    expect(mockInvoke).not.toHaveBeenCalled();
  });
});
