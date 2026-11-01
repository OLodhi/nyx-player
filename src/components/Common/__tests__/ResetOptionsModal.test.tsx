/**
 * Fenêtre « Réinitialiser films / séries » des Réglages (lot C de l'audit de couverture) : choisir
 * quoi effacer, ne rien effacer sans choix, et se fermer par Annuler, Échap, le fond ou Retour.
 */

import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import type { ResetOptions } from '../../../types/common';
import { render, screen, fireEvent } from '@testing-library/react';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

import ResetOptionsModal from '../ResetOptionsModal';
import { dispatchBack } from '../../../hooks/useBackHandler';

let onConfirm: Mock<(options: ResetOptions) => void>;
let onCancel: Mock<() => void>;

beforeEach(() => {
  onConfirm = vi.fn();
  onCancel = vi.fn();
});

const open = (type: 'movies' | 'series' = 'movies', isOpen = true) =>
  render(<ResetOptionsModal isOpen={isOpen} type={type} onConfirm={onConfirm} onCancel={onCancel} />);

const boxes = () => screen.getAllByRole('checkbox') as HTMLInputElement[];
const resetButton = () => screen.getByText('btn_reset').closest('button')!;

describe('ResetOptionsModal', () => {
  it('fermée : rien n\'est affiché', () => {
    const { container } = open('movies', false);
    expect(container.firstChild).toBeNull();
  });

  it('titre selon le type : films ou séries', () => {
    const { unmount } = open('movies');
    expect(screen.getByText('reset_movies')).toBeInTheDocument();
    unmount();
    open('series');
    expect(screen.getByText('reset_series')).toBeInTheDocument();
  });

  it('à l\'ouverture : rien de coché, bouton « Réinitialiser » désactivé', () => {
    open();
    expect(boxes().map((b) => b.checked)).toEqual([false, false]);
    expect(resetButton()).toBeDisabled();
    fireEvent.click(resetButton());
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('positions de lecture seules : seules elles sont demandées', () => {
    open();
    fireEvent.click(boxes()[0]);
    expect(resetButton()).not.toBeDisabled();
    fireEvent.click(resetButton());
    expect(onConfirm).toHaveBeenCalledWith({ positions: true, cache: false });
  });

  it('les deux cochées : les deux sont demandées', () => {
    open();
    fireEvent.click(boxes()[0]);
    fireEvent.click(boxes()[1]);
    fireEvent.click(resetButton());
    expect(onConfirm).toHaveBeenCalledWith({ positions: true, cache: true });
  });

  it('coché puis décoché : de nouveau rien à effacer', () => {
    open();
    fireEvent.click(boxes()[1]);
    fireEvent.click(boxes()[1]);
    expect(resetButton()).toBeDisabled();
  });

  it('rouverte : les cases sont de nouveau décochées', () => {
    const { rerender } = open();
    fireEvent.click(boxes()[0]);
    rerender(<ResetOptionsModal isOpen={false} type="movies" onConfirm={onConfirm} onCancel={onCancel} />);
    rerender(<ResetOptionsModal isOpen type="movies" onConfirm={onConfirm} onCancel={onCancel} />);
    expect(boxes().map((b) => b.checked)).toEqual([false, false]);
  });

  it('Annuler, Échap, clic sur le fond ou Retour : la fenêtre se ferme sans rien effacer', () => {
    open();
    fireEvent.click(screen.getByText('modal_cancel'));
    fireEvent.keyDown(window, { key: 'Escape' });
    fireEvent.click(document.querySelector('.confirm-modal-backdrop')!);
    expect(dispatchBack()).toBe(true);
    expect(onCancel).toHaveBeenCalledTimes(4);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('clic dans la fenêtre ou autre touche : elle reste ouverte', () => {
    open();
    fireEvent.click(document.querySelector('.reset-options-modal')!);
    fireEvent.keyDown(window, { key: 'Enter' });
    expect(onCancel).not.toHaveBeenCalled();
  });

  it('fermée : Échap et Retour ne la concernent plus', () => {
    open('movies', false);
    fireEvent.keyDown(window, { key: 'Escape' });
    dispatchBack();
    expect(onCancel).not.toHaveBeenCalled();
  });
});
