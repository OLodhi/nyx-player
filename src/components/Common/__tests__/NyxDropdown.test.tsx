/**
 * Tests pour NyxDropdown — Kit UI v2
 *
 * Couvre : montage, toggle, selection, Escape, disabled, aria.
 * Le panel est rendu via React Portal (document.body).
 */

import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';

// Mock CSS
vi.mock('../NyxDropdown.css', () => ({}));

import NyxDropdown from '../NyxDropdown';

const defaultOptions = [
  { value: 'alpha', label: 'Alpha' },
  { value: 'beta', label: 'Beta' },
  { value: 'gamma', label: 'Gamma' },
];

describe('NyxDropdown', () => {
  it('se monte sans crash', () => {
    const { container } = render(
      <NyxDropdown value="alpha" onChange={vi.fn()} options={defaultOptions} />,
    );
    expect(container.querySelector('.nyx-dropdown')).toBeInTheDocument();
  });

  it('affiche le label de la valeur selectionnee dans le trigger', () => {
    const { container } = render(
      <NyxDropdown value="beta" onChange={vi.fn()} options={defaultOptions} />,
    );
    const trigger = container.querySelector('.nyx-dropdown__value');
    expect(trigger?.textContent).toBe('Beta');
  });

  it('n\'est PAS ouvert par defaut', () => {
    const { container } = render(
      <NyxDropdown value="alpha" onChange={vi.fn()} options={defaultOptions} />,
    );
    expect(container.querySelector('.nyx-dropdown--open')).not.toBeInTheDocument();
  });

  it('toggle le panel au clic sur le trigger', () => {
    const { container } = render(
      <NyxDropdown value="alpha" onChange={vi.fn()} options={defaultOptions} />,
    );
    const trigger = container.querySelector('.nyx-dropdown__trigger')!;

    fireEvent.click(trigger);
    expect(container.querySelector('.nyx-dropdown--open')).toBeInTheDocument();
    // Panel portal visible dans document.body
    expect(document.body.querySelector('.nyx-dropdown__panel--open')).toBeInTheDocument();

    fireEvent.click(trigger);
    expect(container.querySelector('.nyx-dropdown--open')).not.toBeInTheDocument();
    expect(document.body.querySelector('.nyx-dropdown__panel--open')).not.toBeInTheDocument();
  });

  it('appelle onChange au clic sur une option', () => {
    const onChange = vi.fn();
    const { container } = render(
      <NyxDropdown value="alpha" onChange={onChange} options={defaultOptions} />,
    );

    // Ouvrir
    fireEvent.click(container.querySelector('.nyx-dropdown__trigger')!);

    // Cliquer sur Beta (dans le portal)
    const items = document.body.querySelectorAll('.nyx-dropdown__item');
    fireEvent.click(items[1]); // Beta
    expect(onChange).toHaveBeenCalledWith('beta');
  });

  it('ferme le panel apres selection', () => {
    const { container } = render(
      <NyxDropdown value="alpha" onChange={vi.fn()} options={defaultOptions} />,
    );

    fireEvent.click(container.querySelector('.nyx-dropdown__trigger')!);
    expect(document.body.querySelector('.nyx-dropdown__panel--open')).toBeInTheDocument();

    const items = document.body.querySelectorAll('.nyx-dropdown__item');
    fireEvent.click(items[1]);
    expect(document.body.querySelector('.nyx-dropdown__panel--open')).not.toBeInTheDocument();
  });

  it('ferme le panel a la touche Escape', () => {
    const { container } = render(
      <NyxDropdown value="alpha" onChange={vi.fn()} options={defaultOptions} />,
    );
    const root = container.querySelector('.nyx-dropdown')!;

    fireEvent.click(container.querySelector('.nyx-dropdown__trigger')!);
    expect(document.body.querySelector('.nyx-dropdown__panel--open')).toBeInTheDocument();

    fireEvent.keyDown(root, { key: 'Escape' });
    expect(document.body.querySelector('.nyx-dropdown__panel--open')).not.toBeInTheDocument();
  });

  it('laisse passer Escape quand la liste est fermée, pour que Retour quitte la page', () => {
    // Fiche série TV : sur « Saison 1 » (liste fermée), le premier Retour restait sans effet
    // parce que le sélecteur retenait la touche (preventDefault) et que la navigation l'ignorait
    const { container } = render(
      <NyxDropdown value="alpha" onChange={vi.fn()} options={defaultOptions} />,
    );
    const root = container.querySelector('.nyx-dropdown')!;
    expect(fireEvent.keyDown(root, { key: 'Escape' })).toBe(true);
  });

  it('garde Escape pour fermer la liste quand elle est ouverte', () => {
    const { container } = render(
      <NyxDropdown value="alpha" onChange={vi.fn()} options={defaultOptions} />,
    );
    const root = container.querySelector('.nyx-dropdown')!;
    fireEvent.click(container.querySelector('.nyx-dropdown__trigger')!);
    expect(fireEvent.keyDown(root, { key: 'Escape' })).toBe(false);
  });

  it('ne s\'ouvre PAS quand disabled', () => {
    const { container } = render(
      <NyxDropdown value="alpha" onChange={vi.fn()} options={defaultOptions} disabled />,
    );
    expect(container.querySelector('.nyx-dropdown--disabled')).toBeInTheDocument();

    fireEvent.click(container.querySelector('.nyx-dropdown__trigger')!);
    expect(container.querySelector('.nyx-dropdown--open')).not.toBeInTheDocument();
  });

  it('marque l\'option active avec aria-selected', () => {
    const { container } = render(
      <NyxDropdown value="beta" onChange={vi.fn()} options={defaultOptions} />,
    );

    fireEvent.click(container.querySelector('.nyx-dropdown__trigger')!);

    const items = document.body.querySelectorAll('[role="option"]');
    expect(items[0]).toHaveAttribute('aria-selected', 'false');
    expect(items[1]).toHaveAttribute('aria-selected', 'true');
    expect(items[2]).toHaveAttribute('aria-selected', 'false');
  });

  it('affiche le check indicator sur l\'option active', () => {
    const { container } = render(
      <NyxDropdown value="gamma" onChange={vi.fn()} options={defaultOptions} />,
    );

    fireEvent.click(container.querySelector('.nyx-dropdown__trigger')!);

    const activeItem = document.body.querySelector('.nyx-dropdown__item--active');
    expect(activeItem).toBeInTheDocument();
    expect(activeItem?.querySelector('.nyx-dropdown__item-check')).toBeInTheDocument();
  });

  it('positionne le panel en fixed via le portal', () => {
    const { container } = render(
      <NyxDropdown value="alpha" onChange={vi.fn()} options={defaultOptions} />,
    );

    fireEvent.click(container.querySelector('.nyx-dropdown__trigger')!);

    const panel = document.body.querySelector('.nyx-dropdown__panel') as HTMLElement;
    expect(panel).toBeInTheDocument();
    expect(panel.style.position).toBe('fixed');
  });
});
