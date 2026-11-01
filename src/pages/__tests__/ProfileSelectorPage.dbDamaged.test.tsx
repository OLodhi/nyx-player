/**
 * Base de l'appareil abîmée avec une session enregistrée. Le démarrage
 * passe par le choix du profil, et l'avertissement avec « Réinitialiser cet appareil » n'existait
 * que sur l'écran du fournisseur : l'utilisateur restait sur les profils sans explication.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import ProfileSelectorPage from '../ProfileSelectorPage';
import type { UserProfile } from '../../services/profileService';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { resolvedLanguage: 'fr', changeLanguage: vi.fn() } }),
}));
vi.mock('../ProfileSelectorPage.css', () => ({}));
vi.mock('../../assets/brand/logo-secondaire-blanc.svg', () => ({ default: '' }));

const dbHealth = vi.hoisted(() => ({ damaged: false }));
vi.mock('../../services/localDatabaseHealth', () => ({ useLocalDatabaseDamaged: () => dbHealth.damaged }));
const performFullReset = vi.hoisted(() => vi.fn(async () => {}));
vi.mock('../../services/fullResetService', () => ({ performFullReset }));

const profiles: UserProfile[] = [{
  id: 'a', user_id: 'u1', display_name: 'Anna', avatar_color: '#fff', is_active: true, created_at: '', updated_at: '',
}];

const renderPage = () =>
  render(<ProfileSelectorPage profiles={profiles} onSelectProfile={vi.fn()} onSignOut={vi.fn()} />);

describe('ProfileSelectorPage — base de l\'appareil abîmée', () => {
  beforeEach(() => {
    dbHealth.damaged = false;
    performFullReset.mockClear();
  });

  it('base saine : pas d\'avertissement', () => {
    renderPage();
    expect(screen.queryByTestId('profile-db-damaged')).toBeNull();
  });

  it('base abîmée : avertissement et réinitialisation proposés dès le choix du profil, après confirmation', async () => {
    dbHealth.damaged = true;
    renderPage();

    expect(screen.getByTestId('profile-db-damaged')).toHaveTextContent('common:local_db_damaged_message');
    fireEvent.click(screen.getByTestId('profile-db-reset'));
    expect(performFullReset).not.toHaveBeenCalled();
    expect(screen.getByText('common:local_db_reset_confirm')).toBeInTheDocument();

    const buttons = screen.getAllByText('common:local_db_reset_button');
    fireEvent.click(buttons[buttons.length - 1]);
    await vi.waitFor(() => expect(performFullReset).toHaveBeenCalledTimes(1));
    // Cet appareil seulement : ni le cloud ni le compte
    expect(performFullReset).toHaveBeenCalledWith();
  });

  it('réinitialisation en échec : le message le dit et le bouton redevient utilisable', async () => {
    dbHealth.damaged = true;
    performFullReset.mockRejectedValueOnce(new Error('verrou'));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    renderPage();

    fireEvent.click(screen.getByTestId('profile-db-reset'));
    const buttons = screen.getAllByText('common:local_db_reset_button');
    fireEvent.click(buttons[buttons.length - 1]);

    await screen.findByText('common:local_db_reset_failed');
    expect(screen.getByTestId('profile-db-reset')).not.toBeDisabled();
  });

  // Affichage : bandeau et bouton côte à côte écrasaient le texte sur téléphone, et
  // le bandeau poussait « Se déconnecter » sous le bas de l'écran TV. Les surcouches (mobile.css,
  // tv.css) s'accrochent à ces classes, vérifiées avec leurs règles dans styles/__tests__/localDbNoticeCss.test.ts
  it('base abîmée : classes de mise en page du bandeau et resserrement de l\'écran posés', () => {
    dbHealth.damaged = true;
    renderPage();

    const banner = screen.getByTestId('profile-db-damaged');
    expect(banner).toHaveClass('local-db-notice', 'profile-selector__db-damaged');
    expect(banner.querySelector('p')).toHaveClass('local-db-notice__text');
    expect(screen.getByTestId('profile-db-reset')).toHaveClass('local-db-notice__reset');
    expect(banner.closest('.profile-selector__content')).toHaveClass('profile-selector__content--db-damaged');
  });

  it('base saine : l\'écran garde ses écarts habituels', () => {
    const { container } = renderPage();
    expect(container.querySelector('.profile-selector__content')).not.toHaveClass('profile-selector__content--db-damaged');
  });
});
