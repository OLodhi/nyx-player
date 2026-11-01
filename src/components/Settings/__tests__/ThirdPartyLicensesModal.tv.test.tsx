/**
 * Fenêtre des licences (« À propos ») à la télécommande : comme « Gérer les catégories » autrefois,
 * elle n'était pas un calque « modal ». Les boutons de la page « À propos » derrière elle restaient
 * donc atteignables aux flèches, et au bord de sa liste c'est la page derrière qui défilait. Comme
 * ConfirmModal : la sélection reste dans la fenêtre.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import ThirdPartyLicensesModal from '../ThirdPartyLicensesModal';
import { candidates } from '../../../utils/spatialNavigation/dom';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('../../../hooks/useBackHandler', () => ({ useBackHandler: () => {} }));
vi.mock('../../../services/externalLink', () => ({ openExternalLink: vi.fn() }));
vi.mock('../../../utils/platform', () => ({ isAndroid: () => true, isTv: () => true }));

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});

describe('ThirdPartyLicensesModal — télécommande', () => {
  it('ne propose pas les boutons de la page derrière la fenêtre', () => {
    // jsdom ne calcule pas de mise en page : chaque élément reçoit une boîte visible
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(
      { x: 0, y: 0, top: 0, left: 0, right: 100, bottom: 40, width: 100, height: 40, toJSON: () => ({}) } as DOMRect,
    );
    const behind = document.createElement('button');
    behind.textContent = 'settings-licenses';
    document.body.appendChild(behind);

    const { getByTestId, getAllByTestId } = render(<ThirdPartyLicensesModal isOpen onClose={() => {}} />);
    const pool = candidates(getByTestId('licenses-close'));

    expect(pool).not.toContain(behind);
    expect(pool).toContain(getAllByTestId('licenses-source')[0]);
    expect(getByTestId('licenses-modal').getAttribute('data-nav-layer')).toBe('modal');
  });

  it('prend la sélection à l\'ouverture et la rend au bouton « Licences » à la fermeture', () => {
    // Avant : la sélection restait sur « Licences », derrière la fenêtre, puis tombait sur la page
    // entière quand la fenêtre se fermait sur un de ses boutons
    const opener = document.createElement('button');
    document.body.appendChild(opener);
    opener.focus();
    const { rerender, getByTestId } = render(<ThirdPartyLicensesModal isOpen onClose={() => {}} />);
    expect(document.activeElement).toBe(getByTestId('licenses-close'));
    rerender(<ThirdPartyLicensesModal isOpen={false} onClose={() => {}} />);
    expect(document.activeElement).toBe(opener);
  });
});
