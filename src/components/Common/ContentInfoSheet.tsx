/**
 * ContentInfoSheet — Résumé d'un contenu, en fenêtre remontant du bas (téléphone).
 *
 * Sur téléphone, le bouton « i » d'une affiche affichait le synopsis à l'intérieur de la carte :
 * texte minuscule et défilement impraticable. Ici le texte est lisible et défile normalement.
 */

import React from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { useBackHandler } from '../../hooks/useBackHandler';
import WatchlistButton from './WatchlistButton';
import './ContentInfoSheet.css';

interface ContentInfoSheetProps {
  isOpen: boolean;
  title: string;
  image?: string;
  /** Note ou badge affiché sur la carte (ex. « ★ 6.9 ») */
  badge?: string;
  overview?: string;
  /** Ouvre la page détail du contenu */
  onOpenDetails?: () => void;
  inWatchlist?: boolean;
  onToggleWatchlist?: (e: React.MouseEvent) => void;
  onClose: () => void;
}

const ContentInfoSheet: React.FC<ContentInfoSheetProps> = ({
  isOpen,
  title,
  image,
  badge,
  overview,
  onOpenDetails,
  inWatchlist = false,
  onToggleWatchlist,
  onClose,
}) => {
  const { t } = useTranslation('common');
  useBackHandler(isOpen, onClose);

  if (!isOpen) return null;

  return createPortal(
    // stopPropagation : un portail propage ses événements dans l'arbre React (la carte parente)
    <div
      className="info-sheet"
      data-testid="info-sheet"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onClick={(e) => {
        e.stopPropagation();
        onClose();
      }}
    >
      <div className="info-sheet__panel" onClick={(e) => e.stopPropagation()}>
        <div className="info-sheet__grip" />

        <button type="button" className="info-sheet__close" data-testid="info-sheet-close" onClick={onClose} aria-label={t('close')}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>

        <div className="info-sheet__head">
          {image && <img className="info-sheet__poster" src={image} alt="" draggable={false} />}
          <div className="info-sheet__meta">
            <h3 className="info-sheet__title">{title}</h3>
            {badge && <span className="info-sheet__badge">{badge}</span>}
          </div>
        </div>

        <p className="info-sheet__overview">{overview || t('no_synopsis')}</p>

        <div className="info-sheet__actions">
          {onOpenDetails && (
            <button type="button" className="info-sheet__btn info-sheet__btn--primary" data-testid="info-sheet-details" onClick={onOpenDetails}>
              {t('more_info')}
            </button>
          )}
          {onToggleWatchlist && (
            <WatchlistButton
              isAdded={inWatchlist}
              onClick={onToggleWatchlist}
              size="md"
              title={inWatchlist ? t('remove_from_watchlist') : t('add_to_watchlist')}
              testId="info-sheet-watchlist"
            />
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
};

export default ContentInfoSheet;
