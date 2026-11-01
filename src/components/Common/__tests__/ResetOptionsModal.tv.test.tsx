/**
 * Fenêtre « Réinitialiser films / séries » à la télécommande (banc de test) : la
 * sélection restait sur le bouton de la page, derrière la fenêtre, et « Annuler » était inatteignable
 * aux flèches. Comme ConfirmModal : la fenêtre est un calque « modal » (la sélection y reste), elle part
 * de « Annuler » et revient, à la fermeture, sur le bouton qui l'a ouverte.
 */
import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import ResetOptionsModal from '../ResetOptionsModal';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('../../../utils/platform', () => ({ isTv: () => true }));
vi.mock('../../../hooks/useBackHandler', () => ({ useBackHandler: () => {} }));

describe('ResetOptionsModal — télécommande', () => {
  it('garde la sélection dans la fenêtre, part de « Annuler » et la rend au bouton d\'origine', () => {
    const opener = document.createElement('button');
    document.body.appendChild(opener);
    opener.focus();
    const props = { type: 'movies' as const, onConfirm: vi.fn(), onCancel: vi.fn() };
    const { rerender, getByTestId } = render(<ResetOptionsModal {...props} isOpen />);
    expect(getByTestId('reset-options-modal').closest('[data-nav-layer="modal"]')).not.toBeNull();
    expect(document.activeElement).toBe(getByTestId('reset-options-cancel'));
    rerender(<ResetOptionsModal {...props} isOpen={false} />);
    expect(document.activeElement).toBe(opener);
    opener.remove();
  });
});
