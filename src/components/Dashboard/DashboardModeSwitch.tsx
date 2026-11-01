import React from 'react';
import { useTranslation } from 'react-i18next';
import suggestionIcon from '../../assets/icons/suggestion.svg';
import filmIcon from '../../assets/icons/film.svg';
import starIcon from '../../assets/icons/star-outline.svg';
import { inertProps } from '../../utils/inert';
import './DashboardModeSwitch.css';

export type DashboardMode = 'suggestions' | 'films' | 'series';

interface DashboardModeSwitchProps {
  activeMode: DashboardMode;
  onModeChange: (mode: DashboardMode) => void;
  /**
   * Place gardée, onglets cachés et hors d'atteinte (TV, pendant le chargement de l'accueil) : quand ils apparaissent,
   * les rangées au-dessous ne bougent pas. Sans repère du banc, qui attend les vrais onglets.
   */
  reserved?: boolean;
}

const MODE_ICONS: Record<DashboardMode, string> = {
  suggestions: suggestionIcon,
  films: filmIcon,
  series: starIcon,
};

/**
 * DashboardModeSwitch - Pills/Tabs for switching between Dashboard modes
 */
const DashboardModeSwitch: React.FC<DashboardModeSwitchProps> = ({ activeMode, onModeChange, reserved = false }) => {
  const { t } = useTranslation('dashboard');

  const modes: { key: DashboardMode; label: string }[] = [
    { key: 'suggestions', label: t('tab_suggestions') },
    { key: 'films', label: t('tab_movies') },
    { key: 'series', label: t('tab_series') },
  ];

  if (reserved) {
    // Mêmes boutons (même hauteur au pixel près, police comprise), inertes, sous un autre repère que les vrais onglets :
    // le banc attend ceux-ci pour les choisir
    return (
      <div className="dashboard-mode-switch dashboard-mode-switch--reserved" {...inertProps(true)} aria-hidden="true">
        {modes.map(({ key, label }) => (
          <button
            key={key}
            className={`mode-pill ${activeMode === key ? 'active' : ''}`}
            data-testid="dashboard-mode-reserved"
            type="button"
            tabIndex={-1}
          >
            <img src={MODE_ICONS[key]} alt="" className="mode-pill-icon" />
            {label}
          </button>
        ))}
      </div>
    );
  }

  return (
    <div className="dashboard-mode-switch" data-nav-row="dashboard-modes" data-nav-cols="banner" data-nav-top data-testid="dashboard-mode-switch">
      {modes.map(({ key, label }) => (
        <button
          key={key}
          className={`mode-pill ${activeMode === key ? 'active' : ''}`}
          data-testid="dashboard-mode"
          data-mode={key}
          onClick={() => onModeChange(key)}
        >
          <img src={MODE_ICONS[key]} alt="" className="mode-pill-icon" />
          {label}
        </button>
      ))}
    </div>
  );
};

export default React.memo(DashboardModeSwitch);
