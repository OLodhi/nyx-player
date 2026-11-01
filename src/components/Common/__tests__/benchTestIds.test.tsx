/**
 * Repères du banc de test portés par les composants partagés : le repère passé en propriété
 * (`testId`, ou `data-testid` pour NyxButton) arrive bien sur l'élément cliquable.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import ConfirmModal from '../ConfirmModal';
import NyxButton from '../NyxButton';
import NyxDropdown from '../NyxDropdown';
import WatchlistButton from '../WatchlistButton';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('../../../utils/platform', () => ({ isTv: () => false }));
vi.mock('../../../hooks/useBackHandler', () => ({ useBackHandler: () => {} }));
vi.mock('../NyxDropdown.css', () => ({}));

describe('repères du banc sur les composants partagés', () => {
  it('NyxButton transmet data-testid au bouton', () => {
    const { getByTestId } = render(<NyxButton data-testid="exemple-bouton">OK</NyxButton>);
    expect(getByTestId('exemple-bouton').tagName).toBe('BUTTON');
  });

  it('ConfirmModal porte son repère et ceux de ses boutons', () => {
    const { getByTestId } = render(
      <ConfirmModal
        isOpen
        title="Titre"
        message="Message"
        testId="exemple-modal"
        checkbox={{ label: 'Case', checked: false, onChange: vi.fn() }}
        extraAction={{ label: 'Autre', onClick: vi.fn() }}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    const modal = getByTestId('exemple-modal');
    for (const id of ['confirm-modal-checkbox', 'confirm-modal-cancel', 'confirm-modal-extra', 'confirm-modal-confirm']) {
      expect(modal.querySelector(`[data-testid="${id}"]`), id).not.toBeNull();
    }
  });

  it('ConfirmModal sans repère propre garde « confirm-modal »', () => {
    const { getByTestId } = render(<ConfirmModal isOpen title="T" message="M" onCancel={vi.fn()} />);
    expect(getByTestId('confirm-modal')).toBeTruthy();
  });

  it('WatchlistButton porte le repère reçu, sinon « watchlist-button »', () => {
    const { getByTestId, rerender } = render(<WatchlistButton isAdded={false} onClick={vi.fn()} testId="exemple-liste" />);
    expect(getByTestId('exemple-liste').tagName).toBe('BUTTON');
    rerender(<WatchlistButton isAdded={false} onClick={vi.fn()} />);
    expect(getByTestId('watchlist-button').tagName).toBe('BUTTON');
  });

  it('NyxDropdown : repère sur le bouton, « -list » sur la liste, data-value sur les choix', () => {
    const options = [{ value: 'fr', label: 'Français' }, { value: 'en', label: 'English' }];
    const { getByTestId } = render(<NyxDropdown value="fr" onChange={vi.fn()} options={options} testId="exemple-choix" />);
    fireEvent.click(getByTestId('exemple-choix'));
    const list = getByTestId('exemple-choix-list');
    expect(list.querySelector('[data-value="en"]')).not.toBeNull();
  });

  it('NyxDropdown sans repère n\'en ajoute aucun', () => {
    const { container } = render(<NyxDropdown value="a" onChange={vi.fn()} options={[{ value: 'a', label: 'A' }]} />);
    expect(container.querySelector('[data-testid]')).toBeNull();
    expect(document.body.querySelector('[role="listbox"][data-testid]')).toBeNull();
  });
});
