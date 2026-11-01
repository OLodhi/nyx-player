/**
 * Synchro relancée pendant la session (sync/syncScheduler.ts) : au retour du réseau, au
 * retour dans l'app, régulièrement ; jamais pendant une vidéo, jamais pour un autre compte.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const syncAll = vi.fn(async () => ({ errors: [] }));
vi.mock('../sync/syncService', () => ({ syncAll: (...args: unknown[]) => syncAll(...(args as [])) }));
let sameAccount = true;
vi.mock('../sync/syncBaseline', () => ({ isSameAccount: () => sameAccount, bumpGeneration: vi.fn() }));
vi.mock('../../utils/devLog', () => ({ devLog: vi.fn() }));

import { startCloudResync, stopCloudResync, EVERY_MS, MIN_GAP_MS, ONLINE_DELAY_MS } from '../sync/syncScheduler';
import { setPlaybackBusy } from '../playbackActivity';
import { bumpGeneration } from '../sync/syncBaseline';

function setVisible() {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
    document.dispatchEvent(new Event('visibilitychange'));
}

describe('syncScheduler', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        syncAll.mockClear();
        sameAccount = true;
        setPlaybackBusy(false);
    });

    afterEach(() => {
        stopCloudResync();
        vi.useRealTimers();
    });

    it('syncs again when the network comes back (failed sends are caught up)', async () => {
        startCloudResync('user-1');
        window.dispatchEvent(new Event('online'));
        await vi.advanceTimersByTimeAsync(ONLINE_DELAY_MS);
        expect(syncAll).toHaveBeenCalledWith('user-1');
    });

    it('syncs regularly while the app stays open (a TV left on for days)', async () => {
        startCloudResync('user-1');
        await vi.advanceTimersByTimeAsync(EVERY_MS * 2);
        expect(syncAll).toHaveBeenCalledTimes(2);
    });

    it('syncs when the app comes back to the foreground, but not twice in a row', async () => {
        startCloudResync('user-1');
        setVisible();
        expect(syncAll).not.toHaveBeenCalled(); // la synchro d'ouverture vient d'avoir lieu
        await vi.advanceTimersByTimeAsync(MIN_GAP_MS);
        setVisible();
        await vi.advanceTimersByTimeAsync(0);
        setVisible();
        await vi.advanceTimersByTimeAsync(0);
        expect(syncAll).toHaveBeenCalledTimes(1);
    });

    it('waits for the end of the video', async () => {
        startCloudResync('user-1');
        setPlaybackBusy(true);
        await vi.advanceTimersByTimeAsync(EVERY_MS);
        expect(syncAll).not.toHaveBeenCalled();
        setPlaybackBusy(false);
        await vi.advanceTimersByTimeAsync(0);
        expect(syncAll).toHaveBeenCalledTimes(1);
    });

    it('never syncs for an account that is no longer the one signed in', async () => {
        startCloudResync('user-1');
        sameAccount = false;
        await vi.advanceTimersByTimeAsync(EVERY_MS);
        expect(syncAll).not.toHaveBeenCalled();
    });

    it('stops everything on sign-out', async () => {
        startCloudResync('user-1');
        stopCloudResync();
        window.dispatchEvent(new Event('online'));
        setVisible();
        await vi.advanceTimersByTimeAsync(EVERY_MS * 2);
        expect(syncAll).not.toHaveBeenCalled();
    });

    it('syncs when the window is activated again (Windows, where the page visibility does not always change)', async () => {
        startCloudResync('user-1');
        window.dispatchEvent(new Event('focus'));
        expect(syncAll).not.toHaveBeenCalled(); // la synchro d'ouverture vient d'avoir lieu
        await vi.advanceTimersByTimeAsync(MIN_GAP_MS);
        window.dispatchEvent(new Event('focus'));
        await vi.advanceTimersByTimeAsync(0);
        expect(syncAll).toHaveBeenCalledTimes(1);
    });

    it('syncs only once when the window activation and the page visibility arrive together', async () => {
        startCloudResync('user-1');
        await vi.advanceTimersByTimeAsync(MIN_GAP_MS);
        window.dispatchEvent(new Event('focus'));
        setVisible();
        await vi.advanceTimersByTimeAsync(0);
        expect(syncAll).toHaveBeenCalledTimes(1);
    });

    it('ignores the window activation after sign-out', async () => {
        startCloudResync('user-1');
        stopCloudResync();
        await vi.advanceTimersByTimeAsync(MIN_GAP_MS);
        window.dispatchEvent(new Event('focus'));
        await vi.advanceTimersByTimeAsync(0);
        expect(syncAll).not.toHaveBeenCalled();
    });

    it('syncs right away when asked (« Rafraîchir »), then keeps the usual gap', async () => {
        startCloudResync('user-1', { syncNow: true });
        await vi.advanceTimersByTimeAsync(0);
        expect(syncAll).toHaveBeenCalledTimes(1);
        expect(syncAll).toHaveBeenCalledWith('user-1');
        // Le retour dans l'app qui suit attend l'écart minimal, compté depuis cette synchro
        await vi.advanceTimersByTimeAsync(MIN_GAP_MS - 1);
        setVisible();
        await vi.advanceTimersByTimeAsync(0);
        expect(syncAll).toHaveBeenCalledTimes(1);
        await vi.advanceTimersByTimeAsync(1);
        setVisible();
        await vi.advanceTimersByTimeAsync(0);
        expect(syncAll).toHaveBeenCalledTimes(2);
    });

    it('asked to sync right away twice while the first one runs: a single sync', async () => {
        let finish: () => void = () => {};
        syncAll.mockImplementationOnce(() => new Promise((resolve) => { finish = () => resolve({ errors: [] }); }));
        startCloudResync('user-1', { syncNow: true });
        startCloudResync('user-1', { syncNow: true });
        await vi.advanceTimersByTimeAsync(0);
        expect(syncAll).toHaveBeenCalledTimes(1);
        finish();
        await vi.advanceTimersByTimeAsync(0);
    });

    it('asked to sync right away for an account that is no longer signed in: nothing', async () => {
        sameAccount = false;
        startCloudResync('user-1', { syncNow: true });
        await vi.advanceTimersByTimeAsync(0);
        expect(syncAll).not.toHaveBeenCalled();
    });

    it('asked to sync right away during a video: waits for the end of the video', async () => {
        setPlaybackBusy(true);
        startCloudResync('user-1', { syncNow: true });
        await vi.advanceTimersByTimeAsync(0);
        expect(syncAll).not.toHaveBeenCalled();
        setPlaybackBusy(false);
        await vi.advanceTimersByTimeAsync(0);
        expect(syncAll).toHaveBeenCalledTimes(1);
    });

    it('lets the opening sync keep writing when resync starts, but stops running syncs on sign-out', () => {
        vi.mocked(bumpGeneration).mockClear();
        startCloudResync('user-1');
        expect(bumpGeneration).not.toHaveBeenCalled();
        stopCloudResync();
        expect(bumpGeneration).toHaveBeenCalledTimes(1);
    });
});
