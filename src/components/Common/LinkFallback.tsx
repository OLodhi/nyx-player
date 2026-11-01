/**
 * LinkFallback — fenêtre affichée quand un lien ne peut pas s'ouvrir sur l'appareil (pas de
 * navigateur, par exemple sur une TV) : elle montre l'adresse à ouvrir ailleurs, avec un bouton
 * Fermer. Ouverte par `openExternalLink` (services/externalLink.ts).
 */

import React, { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import ConfirmModal from './ConfirmModal';
import { LINK_FALLBACK_EVENT } from '../../services/externalLink';

const LinkFallback: React.FC = () => {
  const { t } = useTranslation('common');
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    const show = (event: Event) => {
      const address = (event as CustomEvent<string>).detail;
      if (address) setUrl(address);
    };
    window.addEventListener(LINK_FALLBACK_EVENT, show);
    return () => window.removeEventListener(LINK_FALLBACK_EVENT, show);
  }, []);

  const close = useCallback(() => setUrl(null), []);

  // Rendue sous <body>, après les fenêtres déjà ouvertes (licences) : au-dessus d'elles, et retenue
  // par la télécommande (sous #root, elle restait dessous, invisible)
  return createPortal(
    <ConfirmModal
      isOpen={url !== null}
      title={t('link_fallback_title')}
      message={t('link_fallback_message', { url: url ?? '' })}
      cancelText={t('close')}
      danger={false}
      onCancel={close}
      testId="link-fallback"
    />,
    document.body,
  );
};

export default LinkFallback;
