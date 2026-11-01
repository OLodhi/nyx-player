/**
 * AppNotice — message bref (par exemple « Ma liste n'a pas pu être modifiée »), sur toutes les
 * plateformes. Simple message : rien à sélectionner. Même principe que TvExitNotice : la zone reste
 * montée, vide (et masquée) hors affichage, pour qu'un lecteur d'écran annonce le message.
 */

import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { APP_NOTICE_EVENT, APP_NOTICE_MS, type AppNoticeKey } from '../../utils/appNotice';
import './AppNotice.css';

const AppNotice: React.FC = () => {
  const { t } = useTranslation('common');
  /** Message affiché et numéro d'affichage : un nouveau message relance le délai */
  const [notice, setNotice] = useState<{ key: AppNoticeKey; at: number } | null>(null);

  useEffect(() => {
    const show = (event: Event) => {
      const key = (event as CustomEvent<AppNoticeKey>).detail;
      if (key) setNotice({ key, at: Date.now() });
    };
    window.addEventListener(APP_NOTICE_EVENT, show);
    return () => window.removeEventListener(APP_NOTICE_EVENT, show);
  }, []);

  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(null), APP_NOTICE_MS);
    return () => clearTimeout(timer);
  }, [notice]);

  // Sous <body> : au-dessus des panneaux rendus hors de #root (fiche résumé du bas sur téléphone)
  return createPortal(
    <div className="app-notice" role="status" data-testid="app-notice">
      {notice ? t(notice.key) : null}
    </div>,
    document.body,
  );
};

export default AppNotice;
