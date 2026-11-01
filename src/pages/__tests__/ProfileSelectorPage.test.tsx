/**
 * Sélection du profil à la télécommande : en arrivant sur la page,
 * aucun élément n'avait le focus, il fallait un appui sur une flèche avant de pouvoir valider.
 * Le focus doit être posé d'office sur le dernier profil utilisé (sinon le premier), et rendu s'il
 * tombe sur le corps de la page pendant l'arrivée.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import ProfileSelectorPage from '../ProfileSelectorPage';
import type { UserProfile } from '../../services/profileService';
import { setTvMode } from '../../utils/platform';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { resolvedLanguage: 'fr', changeLanguage: vi.fn() } }),
}));
vi.mock('../ProfileSelectorPage.css', () => ({}));
vi.mock('../../assets/brand/logo-secondaire-blanc.svg', () => ({ default: '' }));

function profile(id: string, name: string, isActive: boolean): UserProfile {
  return {
    id,
    user_id: 'u1',
    display_name: name,
    avatar_color: '#fff',
    is_active: isActive,
    created_at: '',
    updated_at: '',
  };
}

const flushFrames = async (count: number) => {
  for (let i = 0; i < count; i++) {
    await act(async () => {
      vi.advanceTimersByTime(20);
    });
  }
};

describe('ProfileSelectorPage — focus par défaut à la télécommande', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    setTvMode(true);
  });
  afterEach(() => {
    setTvMode(false);
    vi.useRealTimers();
  });

  const renderPage = (profiles: UserProfile[]) =>
    render(<ProfileSelectorPage profiles={profiles} onSelectProfile={vi.fn()} onSignOut={vi.fn()} />);

  it('met le focus sur le dernier profil utilisé', async () => {
    renderPage([profile('a', 'Anna', false), profile('b', 'Ben', true)]);
    await flushFrames(2);
    const cards = screen.getAllByTestId('profile-card');
    expect(document.activeElement).toBe(cards[1]);
  });

  it('met le focus sur le premier profil si aucun n’a servi', async () => {
    renderPage([profile('a', 'Anna', false), profile('b', 'Ben', false)]);
    await flushFrames(2);
    expect(document.activeElement).toBe(screen.getAllByTestId('profile-card')[0]);
  });

  it('rend le focus s’il tombe sur le corps de la page pendant l’arrivée', async () => {
    renderPage([profile('a', 'Anna', true)]);
    await flushFrames(2);
    (document.activeElement as HTMLElement).blur();
    expect(document.activeElement).toBe(document.body);
    await flushFrames(3);
    expect(document.activeElement).toBe(screen.getAllByTestId('profile-card')[0]);
  });

  it('ne fait rien hors TV', async () => {
    setTvMode(false);
    renderPage([profile('a', 'Anna', true)]);
    await flushFrames(2);
    expect(document.activeElement).toBe(document.body);
  });
});
