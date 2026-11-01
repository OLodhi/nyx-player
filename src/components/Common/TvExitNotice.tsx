/**
 * TvExitNotice — « Appuyez encore sur Retour pour quitter » (télécommande).
 *
 * Affiché au premier Retour qui quitterait l'app, le temps du délai du second
 * (`utils/spatialNavigation/exitConfirm.ts`). Simple message : rien à sélectionner. La zone reste
 * montée, vide (et masquée) hors affichage : un lecteur d'écran n'annonce pas une zone qui arrive
 * déjà remplie.
 */

import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { EXIT_ARMED_EVENT, EXIT_CONFIRM_MS } from '../../utils/spatialNavigation';
import './TvExitNotice.css';

const TvExitNotice: React.FC = () => {
  const { t } = useTranslation('navigation');
  /** Numéro de l'appui : un nouvel appui relance le délai d'affichage */
  const [shownAt, setShownAt] = useState(0);

  useEffect(() => {
    const show = () => setShownAt(Date.now());
    window.addEventListener(EXIT_ARMED_EVENT, show);
    return () => window.removeEventListener(EXIT_ARMED_EVENT, show);
  }, []);

  useEffect(() => {
    if (!shownAt) return;
    const timer = setTimeout(() => setShownAt(0), EXIT_CONFIRM_MS);
    return () => clearTimeout(timer);
  }, [shownAt]);

  return (
    <div className="tv-exit-notice" role="status" data-testid="exit-confirm-notice">
      {shownAt ? t('press_back_again_to_exit') : null}
    </div>
  );
};

export default TvExitNotice;
