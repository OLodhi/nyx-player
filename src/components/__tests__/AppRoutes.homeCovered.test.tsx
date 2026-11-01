/**
 * Accueil caché par une fiche ou par la lecture : AppRoutes le signale à DashboardPage, qui arrête la
 * rotation de la bannière (fluidité sur Chromecast : elle chargeait une photo et redessinait
 * toutes les 18 s sous la fiche et pendant la vidéo).
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('../../pages/DashboardPage', () => ({
    default: ({ heroPaused }: { heroPaused?: boolean }) => (
        <div data-testid="dashboard" data-paused={String(heroPaused)} />
    ),
}));
vi.mock('../../pages/LiveTvPage', () => ({ default: () => null }));
vi.mock('../lazyPages', () => ({
    SettingsPage: () => null,
    WatchlistPage: () => null,
    GlobalSearchPage: () => null,
    CategoryDetailPage: () => null,
}));

import AppRoutes from '../AppRoutes';
import type { LightIndexes } from '../../types/lightIndex';

const props = {
    activeTab: 'dashboard',
    categoryDetail: null,
    searchQuery: '',
    onSearchChange: vi.fn(),
    lightIndexes: {} as LightIndexes,
    iptvStatus: 'ok' as const,
    navigateToContent: vi.fn(),
    navigateToCategory: vi.fn(),
    goBack: vi.fn(),
    liveTvSelectedCategory: 'all',
    liveTvViewMode: 'list' as never,
};

describe('AppRoutes — accueil caché', () => {
    it('signale à l\'accueil qu\'une fiche ou la lecture le recouvre', () => {
        const { rerender } = render(<AppRoutes {...props} />);
        expect(screen.getByTestId('dashboard').dataset.paused).toBe('false');
        rerender(<AppRoutes {...props} homeCovered />);
        expect(screen.getByTestId('dashboard').dataset.paused).toBe('true');
    });
});
