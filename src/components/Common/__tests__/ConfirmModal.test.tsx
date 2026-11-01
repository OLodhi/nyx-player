/**
 * ConfirmModal sur TV (Chromecast) : la sélection part de « Annuler » et revient, à la fermeture,
 * sur l'élément qui a ouvert la fenêtre.
 */

import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import ConfirmModal from '../ConfirmModal';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('../../../utils/platform', () => ({ isTv: () => true }));
vi.mock('../../../hooks/useBackHandler', () => ({ useBackHandler: () => {} }));

describe('ConfirmModal — télécommande', () => {
  it('rend la sélection à l\'élément qui a ouvert la fenêtre', () => {
    const opener = document.createElement('button');
    document.body.appendChild(opener);
    opener.focus();
    const props = { title: 'Titre', message: 'Message', onConfirm: vi.fn(), onCancel: vi.fn() };
    const { rerender, getByText } = render(<ConfirmModal {...props} isOpen cancelText="Annuler" />);
    expect(document.activeElement).toBe(getByText('Annuler').closest('button'));
    rerender(<ConfirmModal {...props} isOpen={false} cancelText="Annuler" />);
    expect(document.activeElement).toBe(opener);
    opener.remove();
  });
});

describe('ConfirmModal — précision sous la case', () => {
  it('affiche la précision et la relie à la case pour les lecteurs d\'écran', () => {
    const { getByRole, getByText } = render(
      <ConfirmModal
        isOpen
        title="Titre"
        message="Message"
        onCancel={vi.fn()}
        checkbox={{ label: 'Case', checked: false, onChange: vi.fn(), hint: 'Ce qui est effacé' }}
      />,
    );
    const hint = getByText('Ce qui est effacé');
    expect(getByRole('checkbox').getAttribute('aria-describedby')).toBe(hint.id);
    expect(hint.id).not.toBe('');
  });

  it('sans précision, rien de plus sous la case', () => {
    const { getByRole, container } = render(
      <ConfirmModal isOpen title="Titre" message="Message" onCancel={vi.fn()} checkbox={{ label: 'Case', checked: false, onChange: vi.fn() }} />,
    );
    expect(getByRole('checkbox').hasAttribute('aria-describedby')).toBe(false);
    expect(container.querySelector('.confirm-modal-checkbox-hint')).toBeNull();
  });
});
