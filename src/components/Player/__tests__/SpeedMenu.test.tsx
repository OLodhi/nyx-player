/**
 * Tests pour SpeedMenu.tsx
 *
 * Teste le rendu, les options de vitesse, et les interactions utilisateur.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { createRef } from 'react';
import SpeedMenu from '../SpeedMenu';

// Mock i18n pour retourner les traductions FR
vi.mock('react-i18next', () => ({
    useTranslation: () => ({
        t: (key: string) => {
            const translations: Record<string, string> = {
                'playback_speed': 'Vitesse de lecture',
            };
            return translations[key] || key;
        },
    }),
}));

const defaultProps = {
    isOpen: false,
    currentSpeed: 1,
    menuRef: createRef<HTMLDivElement>(),
    onToggle: vi.fn(),
    onSelectSpeed: vi.fn(),
};

describe('SpeedMenu', () => {
    describe('Rendu fermé', () => {
        it('affiche le bouton avec la vitesse actuelle', () => {
            render(<SpeedMenu {...defaultProps} currentSpeed={1.5} />);

            expect(screen.getByRole('button')).toHaveTextContent('1.5x');
        });

        it('n\'affiche pas le menu quand fermé', () => {
            const { container } = render(<SpeedMenu {...defaultProps} isOpen={false} />);

            expect(container.querySelector('.player-speed-menu')).toBeNull();
        });
    });

    describe('Rendu ouvert', () => {
        it('affiche le menu avec toutes les options de vitesse', () => {
            const { container } = render(<SpeedMenu {...defaultProps} isOpen={true} />);

            // Vérifie que le menu contient toutes les 6 options
            const speedItems = container.querySelectorAll('.speed-item');
            expect(speedItems.length).toBe(6);

            // Vérifie les valeurs (0.5, 0.75, 1, 1.25, 1.5, 2)
            const values = Array.from(speedItems).map((el) => el.textContent);
            expect(values).toEqual(['0.5x', '0.75x', '1x', '1.25x', '1.5x', '2x']);
        });

        it('marque la vitesse actuelle comme active', () => {
            const { container } = render(<SpeedMenu {...defaultProps} isOpen={true} currentSpeed={1.5} />);

            const activeItem = container.querySelector('.speed-item.active');
            expect(activeItem).not.toBeNull();
            expect(activeItem?.textContent).toBe('1.5x');
        });
    });

    describe('Interactions', () => {
        it('appelle onToggle au clic sur le bouton', () => {
            const onToggleMock = vi.fn();
            render(<SpeedMenu {...defaultProps} onToggle={onToggleMock} />);

            fireEvent.click(screen.getByRole('button'));

            expect(onToggleMock).toHaveBeenCalledTimes(1);
        });

        it('appelle onSelectSpeed avec la bonne vitesse', () => {
            const onSelectSpeedMock = vi.fn();
            render(<SpeedMenu {...defaultProps} isOpen={true} onSelectSpeed={onSelectSpeedMock} />);

            // Clic sur 2x
            fireEvent.click(screen.getByText('2x'));

            expect(onSelectSpeedMock).toHaveBeenCalledWith(2);
        });

        it('appelle onSelectSpeed pour chaque option', () => {
            const onSelectSpeedMock = vi.fn();
            render(<SpeedMenu {...defaultProps} isOpen={true} onSelectSpeed={onSelectSpeedMock} />);

            // Test toutes les vitesses
            fireEvent.click(screen.getByText('0.5x'));
            expect(onSelectSpeedMock).toHaveBeenLastCalledWith(0.5);

            fireEvent.click(screen.getByText('1.25x'));
            expect(onSelectSpeedMock).toHaveBeenLastCalledWith(1.25);
        });
    });

    describe('Accessibilité', () => {
        it('a un title sur le bouton', () => {
            render(<SpeedMenu {...defaultProps} />);

            expect(screen.getByRole('button')).toHaveAttribute('title', 'Vitesse de lecture');
        });
    });

    describe('Télécommande (Android TV)', () => {
        it('chaque vitesse est sélectionnable et OK la choisit', () => {
            const onSelectSpeed = vi.fn();
            const { container } = render(<SpeedMenu {...defaultProps} isOpen={true} onSelectSpeed={onSelectSpeed} />);
            const menu = container.querySelector('.player-speed-menu')!;
            expect(menu).toHaveAttribute('data-nav-layer', 'modal');
            const items = container.querySelectorAll('.speed-item');
            items.forEach((item) => {
                expect(item).toHaveAttribute('role', 'button');
                expect(item).toHaveAttribute('tabindex', '0');
            });
            fireEvent.keyDown(items[4], { key: 'Enter' });
            expect(onSelectSpeed).toHaveBeenCalledWith(1.5);
        });
    });
});
