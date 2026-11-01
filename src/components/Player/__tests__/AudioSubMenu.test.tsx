/**
 * Tests pour AudioSubMenu.tsx
 *
 * Teste le rendu des pistes audio/sous-titres et les interactions.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { createRef } from 'react';
import AudioSubMenu, { type Track } from '../AudioSubMenu';

// Mock i18n pour retourner les traductions FR
vi.mock('react-i18next', () => ({
    useTranslation: () => ({
        t: (key: string, options?: { count?: number }) => {
            const translations: Record<string, string> = {
                'disabled': 'Désactivé',
                'no_track': 'Aucune piste',
                'text_size': 'Taille du texte',
                'scale_normal': 'Normal',
                'audio_subs_menu': 'Audio & Sous-titres',
                'header_audio': `AUDIO (${options?.count || 0})`,
                'header_subs': `SOUS-TITRES (${options?.count || 0})`,
            };
            return translations[key] || key;
        },
    }),
}));

const mockAudioTracks: Track[] = [
    { id: 1, type: 'audio', title: 'Français', lang: 'fr' },
    { id: 2, type: 'audio', title: 'English', lang: 'en' },
];

const mockSubTracks: Track[] = [
    { id: 1, type: 'sub', title: 'Français', lang: 'fr' },
    { id: 2, type: 'sub', lang: 'en' },
];

const defaultProps = {
    isOpen: false,
    menuRef: createRef<HTMLDivElement>(),
    audioTracks: mockAudioTracks,
    subTracks: mockSubTracks,
    currentAudioId: 1,
    currentSubId: 0,
    subtitleScale: 1,
    onToggle: vi.fn(),
    onSelectAudioTrack: vi.fn(),
    onSelectSubTrack: vi.fn(),
    onChangeSubtitleScale: vi.fn(),
};

describe('AudioSubMenu', () => {
    describe('Rendu fermé', () => {
        it('affiche le bouton toggle', () => {
            render(<AudioSubMenu {...defaultProps} />);

            expect(screen.getByRole('button', { name: /audio/i })).toBeInTheDocument();
        });

        it('n\'affiche pas le popup quand fermé', () => {
            const { container } = render(<AudioSubMenu {...defaultProps} isOpen={false} />);

            expect(container.querySelector('.player-audio-sub-popup')).toBeNull();
        });
    });

    describe('Rendu ouvert', () => {
        it('affiche les headers audio et sous-titres', () => {
            render(<AudioSubMenu {...defaultProps} isOpen={true} />);

            expect(screen.getByText(/AUDIO \(2\)/)).toBeInTheDocument();
            expect(screen.getByText(/SOUS-TITRES \(2\)/)).toBeInTheDocument();
        });

        it('affiche les pistes audio', () => {
            const { container } = render(<AudioSubMenu {...defaultProps} isOpen={true} />);

            // Vérifie le header audio
            const audioColumn = container.querySelectorAll('.popup-column')[0];
            expect(audioColumn?.textContent).toContain('Français');
            expect(audioColumn?.textContent).toContain('English');
        });

        it('affiche "Désactivé" pour sous-titres désactivés', () => {
            render(<AudioSubMenu {...defaultProps} isOpen={true} />);

            expect(screen.getByText('Désactivé')).toBeInTheDocument();
        });

        it('affiche le slider de taille', () => {
            render(<AudioSubMenu {...defaultProps} isOpen={true} />);

            expect(screen.getByText('Taille du texte')).toBeInTheDocument();
            expect(screen.getByRole('slider')).toBeInTheDocument();
        });

        it('affiche "Normal" quand scale = 1', () => {
            render(<AudioSubMenu {...defaultProps} isOpen={true} subtitleScale={1} />);

            expect(screen.getByText('Normal')).toBeInTheDocument();
        });

        it('affiche le scale quand != 1', () => {
            render(<AudioSubMenu {...defaultProps} isOpen={true} subtitleScale={1.5} />);

            expect(screen.getByText('1.5x')).toBeInTheDocument();
        });
    });

    describe('Pistes vides', () => {
        it('affiche "Aucune piste" quand pas de pistes audio', () => {
            render(<AudioSubMenu {...defaultProps} isOpen={true} audioTracks={[]} />);

            expect(screen.getByText('Aucune piste')).toBeInTheDocument();
        });
    });

    describe('Interactions', () => {
        it('appelle onToggle au clic sur le bouton', () => {
            const onToggleMock = vi.fn();
            render(<AudioSubMenu {...defaultProps} onToggle={onToggleMock} />);

            fireEvent.click(screen.getByRole('button'));

            expect(onToggleMock).toHaveBeenCalledTimes(1);
        });

        it('appelle onSelectAudioTrack au clic sur piste audio', () => {
            const onSelectMock = vi.fn();
            render(<AudioSubMenu {...defaultProps} isOpen={true} onSelectAudioTrack={onSelectMock} />);

            fireEvent.click(screen.getByText('English'));

            expect(onSelectMock).toHaveBeenCalledWith(2);
        });

        it('appelle onSelectSubTrack au clic sur Désactivé', () => {
            const onSelectMock = vi.fn();
            render(<AudioSubMenu {...defaultProps} isOpen={true} onSelectSubTrack={onSelectMock} />);

            fireEvent.click(screen.getByText('Désactivé'));

            expect(onSelectMock).toHaveBeenCalledWith(0);
        });

        it('appelle onChangeSubtitleScale quand slider change', () => {
            const onChangeMock = vi.fn();
            render(<AudioSubMenu {...defaultProps} isOpen={true} onChangeSubtitleScale={onChangeMock} />);

            const slider = screen.getByRole('slider');
            fireEvent.change(slider, { target: { value: '1.5' } });

            expect(onChangeMock).toHaveBeenCalledWith(1.5);
        });
    });

    describe('État actif', () => {
        it('marque la piste audio active', () => {
            const { container } = render(<AudioSubMenu {...defaultProps} isOpen={true} currentAudioId={2} />);

            // La piste audio English devrait être active
            const audioItems = container.querySelectorAll('.popup-column')[0]?.querySelectorAll('.popup-item');
            const activeAudio = Array.from(audioItems || []).find((el) => el.classList.contains('active'));
            expect(activeAudio?.textContent).toContain('English');
        });

        it('marque Désactivé actif quand currentSubId = 0', () => {
            const { container } = render(<AudioSubMenu {...defaultProps} isOpen={true} currentSubId={0} />);

            // La colonne sous-titres (2ème popup-column)
            const subColumn = container.querySelectorAll('.popup-column')[1];
            const activeItem = subColumn?.querySelector('.popup-item.active .track-name');
            expect(activeItem?.textContent).toBe('Désactivé');
        });
    });

    describe('Télécommande (Android TV)', () => {
        it('pistes et « Désactivé » sont sélectionnables, OK les choisit', () => {
            const onSelectAudioTrack = vi.fn();
            const onSelectSubTrack = vi.fn();
            const { container } = render(
                <AudioSubMenu {...defaultProps} isOpen={true} onSelectAudioTrack={onSelectAudioTrack} onSelectSubTrack={onSelectSubTrack} />,
            );
            expect(container.querySelector('.player-audio-sub-popup')).toHaveAttribute('data-nav-layer', 'modal');
            const items = container.querySelectorAll('.popup-item');
            items.forEach((item) => expect(item).toHaveAttribute('tabindex', '0'));
            fireEvent.keyDown(screen.getByText('English').closest('.popup-item')!, { key: 'Enter' });
            expect(onSelectAudioTrack).toHaveBeenCalledWith(2);
            fireEvent.keyDown(screen.getByText('Désactivé').closest('.popup-item')!, { key: 'Enter' });
            expect(onSelectSubTrack).toHaveBeenCalledWith(0);
        });
    });
});
