/**
 * ThirdPartyLicensesModal — Licences des composants multimédia open source embarqués.
 *
 * Obligation LGPL/GPL : nommer les bibliothèques, leur licence et donner accès au code source
 * de la version exacte (et, pour libmpv Android, à nos scripts de compilation LGPL).
 */

import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { openExternalLink } from '../../services/externalLink';
import { componentsFor, LIBMPV_BUILD_SOURCE, type ThirdPartyComponent } from '../../data/thirdPartyLicenses';
import { useBackHandler } from '../../hooks/useBackHandler';
import { isAndroid, isTv } from '../../utils/platform';
import './ThirdPartyLicensesModal.css';

interface ThirdPartyLicensesModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const ThirdPartyLicensesModal: React.FC<ThirdPartyLicensesModalProps> = ({ isOpen, onClose }) => {
  const { t } = useTranslation('settings');
  const [showAll, setShowAll] = useState(false);
  useBackHandler(isOpen, onClose);

  // TV : comme ConfirmModal, la sélection entre dans la fenêtre (sur Fermer) et revient, à la
  // fermeture, sur le bouton « Licences » ; sinon elle restait derrière puis tombait sur la page
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!isOpen || !isTv()) return;
    const opener = document.activeElement;
    closeRef.current?.focus({ preventScroll: true });
    return () => {
      if (opener instanceof HTMLElement && opener.isConnected) opener.focus({ preventScroll: true });
    };
  }, [isOpen]);

  if (!isOpen) return null;

  const android = isAndroid();
  const all = componentsFor(android ? 'android' : 'desktop');
  const primary = all.filter((c) => c.primary);
  const secondary = all.filter((c) => !c.primary);

  const renderItem = (component: ThirdPartyComponent) => (
    <li key={component.name} className="licenses-modal__item">
      <div className="licenses-modal__name">
        {component.name} <span className="licenses-modal__version">{component.version}</span>
      </div>
      <div className="licenses-modal__meta">
        <span className="licenses-modal__license">{component.license}</span>
        <button type="button" className="licenses-modal__link" data-testid="licenses-source" onClick={() => void openExternalLink(component.sourceUrl)}>
          {t('licenses_source')}
        </button>
      </div>
    </li>
  );

  // Portail : hors du flux centré de « À propos » et au-dessus de la barre de navigation mobile
  return createPortal(
    <div className="licenses-modal" data-testid="licenses-modal" data-nav-layer="modal" role="dialog" aria-modal="true" aria-label={t('licenses_title')} onClick={onClose}>
      <div className="licenses-modal__panel" onClick={(e) => e.stopPropagation()}>
        <header className="licenses-modal__header">
          <h3>{t('licenses_title')}</h3>
          <button ref={closeRef} type="button" className="licenses-modal__close" data-testid="licenses-close" onClick={onClose} aria-label={t('licenses_close')}>
            ✕
          </button>
        </header>

        <p className="licenses-modal__intro">{t(android ? 'licenses_intro_android' : 'licenses_intro_desktop')}</p>
        {android && (
          <button type="button" className="licenses-modal__link" data-testid="licenses-build-source" onClick={() => void openExternalLink(LIBMPV_BUILD_SOURCE)}>
            {t('licenses_build_source')}
          </button>
        )}

        <ul className="licenses-modal__list">
          {primary.map(renderItem)}
          {secondary.length > 0 && (
            <li className="licenses-modal__item">
              <button type="button" className="licenses-modal__link" data-testid="licenses-show-all" onClick={() => setShowAll((v) => !v)} aria-expanded={showAll}>
                {showAll ? t('licenses_show_less') : t('licenses_show_more', { count: secondary.length })}
              </button>
            </li>
          )}
          {showAll && secondary.map(renderItem)}
        </ul>
      </div>
    </div>,
    document.body,
  );
};

export default ThirdPartyLicensesModal;
