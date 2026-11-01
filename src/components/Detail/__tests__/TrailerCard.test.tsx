/**
 * Bande-annonce : ouverte dans le navigateur de l'appareil, jamais dans la fenêtre de l'app. Sur
 * Android, le lien `target="_blank"` chargeait YouTube à la place de l'app, avec l'accès aux
 * commandes natives de l'app.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

const { opened } = vi.hoisted(() => ({ opened: [] as string[] }));
vi.mock('../../../services/externalLink', () => ({
  openExternalLink: vi.fn(async (url: string) => { opened.push(url); }),
}));

import TrailerCard from '../TrailerCard';

describe('TrailerCard', () => {
  it('un appui ouvre la vidéo par le navigateur, sans navigation de la fenêtre', () => {
    render(<TrailerCard trailerKey="abc_123" backdropUrl="" />);
    const link = screen.getByTestId('detail-trailer');
    expect(link.getAttribute('target')).toBeNull();
    const event = new MouseEvent('click', { bubbles: true, cancelable: true });
    fireEvent(link, event);
    expect(event.defaultPrevented).toBe(true);
    expect(opened).toEqual(['https://www.youtube.com/watch?v=abc_123']);
  });
});
