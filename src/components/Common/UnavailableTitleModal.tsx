/**
 * UnavailableTitleModal — Titre de Ma liste introuvable chez le fournisseur actuel.
 *
 * S'ouvre au clic sur une carte « Introuvable » (page Ma liste, rangée Ma liste de l'accueil) :
 * « Rechercher » ouvre la recherche avec le nom du titre déjà tapé, « Retirer » l'enlève de Ma liste.
 * Sans nom connu (titre sans fiche TMDB venu d'un autre fournisseur), seul « Retirer » est proposé.
 * Même fenêtre pour une carte « Introuvable » de « Reprendre » : « Retirer » l'enlève de
 * « Reprendre ».
 */

import React from 'react';
import { useTranslation } from 'react-i18next';
import ConfirmModal from './ConfirmModal';
import { useNavigation } from '../../contexts/NavigationContext';
import { cleanTitle } from '../../utils/itemHelpers';

export interface UnavailableTitle {
  /** Nom affiché ; vide si inconnu */
  name: string;
}

interface UnavailableTitleModalProps {
  /** Titre concerné ; null : fenêtre fermée */
  item: UnavailableTitle | null;
  /** Liste d'où le titre est retiré : Ma liste (par défaut) ou « Reprendre » */
  scope?: 'watchlist' | 'resume';
  onRemove: () => void;
  onClose: () => void;
}

const UnavailableTitleModal: React.FC<UnavailableTitleModalProps> = ({ item, scope = 'watchlist', onRemove, onClose }) => {
  const { t } = useTranslation('navigation');
  const { setActiveTab, setSearchQuery } = useNavigation();

  const name = item ? cleanTitle(item.name) : '';
  const suffix = scope === 'resume' ? '_resume' : '';
  const search = () => {
    onClose();
    // Onglet d'abord : le changer n'efface pas la recherche (seul le menu latéral le fait)
    setActiveTab('search');
    setSearchQuery(name);
  };

  return (
    <ConfirmModal
      testId="unavailable-title-modal"
      isOpen={item !== null}
      title={t('unavailable_title')}
      message={name ? t(`unavailable_message${suffix}`, { title: name }) : t(`unavailable_message_unknown${suffix}`)}
      cancelText={t('unavailable_close')}
      extraAction={{
        label: t('unavailable_remove'),
        danger: true,
        onClick: () => {
          onClose();
          onRemove();
        },
      }}
      danger={false}
      confirmText={t('unavailable_search')}
      onConfirm={name ? search : undefined}
      onCancel={onClose}
    />
  );
};

export default UnavailableTitleModal;
