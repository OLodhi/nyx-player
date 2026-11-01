/**
 * inertProps : un panneau fermé mais monté sort du parcours du focus (attribut `inert`).
 */

import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { inertProps } from '../inert';

describe('inertProps', () => {
  it('pose l\'attribut inert quand le panneau est fermé, rien quand il est ouvert', () => {
    const { container } = render(
      <>
        <div data-testid="closed" {...inertProps(true)} />
        <div data-testid="open" {...inertProps(false)} />
      </>,
    );
    expect(container.querySelector('[data-testid="closed"]')!.hasAttribute('inert')).toBe(true);
    expect(container.querySelector('[data-testid="open"]')!.hasAttribute('inert')).toBe(false);
  });
});
