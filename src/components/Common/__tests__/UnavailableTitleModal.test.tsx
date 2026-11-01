/**
 * Fenêtre d'un titre de Ma liste introuvable chez le fournisseur actuel :
 * « Rechercher » ouvre la recherche avec le nom déjà tapé, « Retirer » l'enlève de Ma liste.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import UnavailableTitleModal from '../UnavailableTitleModal';

const setActiveTab = vi.fn();
const setSearchQuery = vi.fn();

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('../../../utils/platform', () => ({ isTv: () => false }));
vi.mock('../../../hooks/useBackHandler', () => ({ useBackHandler: () => {} }));
vi.mock('../../../contexts/NavigationContext', () => ({
  useNavigation: () => ({ setActiveTab, setSearchQuery }),
}));

beforeEach(() => {
  setActiveTab.mockClear();
  setSearchQuery.mockClear();
});

describe('UnavailableTitleModal', () => {
  it('opens the search with the title already typed', () => {
    const onClose = vi.fn();
    const { getByText } = render(
      <UnavailableTitleModal item={{ name: 'Le Film (2019)' }} onRemove={vi.fn()} onClose={onClose} />,
    );
    fireEvent.click(getByText('unavailable_search'));
    expect(onClose).toHaveBeenCalled();
    expect(setActiveTab).toHaveBeenCalledWith('search');
    expect(setSearchQuery).toHaveBeenCalledWith(expect.stringContaining('Le Film'));
  });

  it('removes the title from Ma liste', () => {
    const onRemove = vi.fn();
    const { getByText } = render(<UnavailableTitleModal item={{ name: 'Le Film' }} onRemove={onRemove} onClose={vi.fn()} />);
    fireEvent.click(getByText('unavailable_remove'));
    expect(onRemove).toHaveBeenCalledTimes(1);
  });

  it('offers no search for a title without a known name', () => {
    const { queryByText, getByText } = render(
      <UnavailableTitleModal item={{ name: '' }} onRemove={vi.fn()} onClose={vi.fn()} />,
    );
    expect(queryByText('unavailable_search')).toBeNull();
    expect(getByText('unavailable_message_unknown')).toBeTruthy();
    expect(getByText('unavailable_remove')).toBeTruthy();
  });

  // Même fenêtre pour une carte « Introuvable » de « Reprendre »
  it('speaks of Reprendre and removes the resume for a Continue watching card', () => {
    const onRemove = vi.fn();
    const onClose = vi.fn();
    const { getByText, queryByText } = render(
      <UnavailableTitleModal item={{ name: 'Le Film' }} scope="resume" onRemove={onRemove} onClose={onClose} />,
    );
    expect(getByText('unavailable_message_resume')).toBeTruthy();
    expect(queryByText('unavailable_message')).toBeNull();
    fireEvent.click(getByText('unavailable_remove'));
    expect(onClose).toHaveBeenCalled();
    expect(onRemove).toHaveBeenCalledTimes(1);
  });

  it('keeps only Remove for a resume without a known name', () => {
    const { getByText, queryByText } = render(
      <UnavailableTitleModal item={{ name: '' }} scope="resume" onRemove={vi.fn()} onClose={vi.fn()} />,
    );
    expect(getByText('unavailable_message_unknown_resume')).toBeTruthy();
    expect(queryByText('unavailable_search')).toBeNull();
  });
});
