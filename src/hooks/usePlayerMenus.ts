/**
 * usePlayerMenus.ts — Menus du lecteur (volume, pistes, vitesse, statistiques).
 *
 * Tient l'état ouvert / fermé de chaque menu et les ferme au clic en dehors (souris).
 * `useCloseMenusOnDialog` ferme vitesse et pistes quand une fenêtre (épisode suivant, erreur
 * de lecture) passe devant, à la télécommande.
 */

import { useState, useEffect, useRef } from 'react';

export function usePlayerMenus() {
  const [showVolumeSlider, setShowVolumeSlider] = useState(false);
  const [showAudioSubMenu, setShowAudioSubMenu] = useState(false);
  const [showSpeedMenu, setShowSpeedMenu] = useState(false);
  const [showGeekStats, setShowGeekStats] = useState(false);

  const audioSubMenuRef = useRef<HTMLDivElement>(null);
  const speedMenuRef = useRef<HTMLDivElement>(null);

  return {
    showVolumeSlider, setShowVolumeSlider,
    showAudioSubMenu, setShowAudioSubMenu,
    showSpeedMenu, setShowSpeedMenu,
    showGeekStats, setShowGeekStats,
    audioSubMenuRef, speedMenuRef,
  };
}

export type PlayerMenus = ReturnType<typeof usePlayerMenus>;

/** Clic en dehors du menu des pistes ou de la vitesse : le menu se ferme. */
export function useCloseMenusOnClickOutside(menus: PlayerMenus): void {
  const { showAudioSubMenu, showSpeedMenu, setShowAudioSubMenu, setShowSpeedMenu, audioSubMenuRef, speedMenuRef } = menus;
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (audioSubMenuRef.current && !audioSubMenuRef.current.contains(event.target as Node)) {
        setShowAudioSubMenu(false);
      }
      if (speedMenuRef.current && !speedMenuRef.current.contains(event.target as Node)) {
        setShowSpeedMenu(false);
      }
    };
    if (showAudioSubMenu || showSpeedMenu) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showAudioSubMenu, showSpeedMenu, audioSubMenuRef, speedMenuRef, setShowAudioSubMenu, setShowSpeedMenu]);
}

/**
 * Télécommande : épisode suivant ou erreur de lecture passe devant vitesse et pistes, qui se ferment
 * (sinon la fenêtre restée ouverte gardait la sélection, sans réponse possible à la nouvelle).
 * Fermeture pendant le rendu, à l'ouverture de la fenêtre, comme avant le découpage.
 */
export function useCloseMenusOnDialog(dialogOpen: boolean, tv: boolean, menus: PlayerMenus): void {
  const [dialogWasOpen, setDialogWasOpen] = useState(dialogOpen);
  if (dialogOpen !== dialogWasOpen) {
    setDialogWasOpen(dialogOpen);
    if (tv && dialogOpen) {
      menus.setShowSpeedMenu(false);
      menus.setShowAudioSubMenu(false);
    }
  }
}
