import { useState, useEffect, useCallback, useRef } from 'react';
import type { HeroMovie } from '../types/dashboard';

// Hero rotation interval (18 seconds)
const HERO_ROTATION_INTERVAL = 18000;

interface UseHeroRotationReturn {
  heroIndex: number;
  isFading: boolean;
  handleDotClick: (index: number) => void;
  /**
   * Bannière « tenue » (focus de la télécommande ou souris dessus) : la rotation s'arrête, et repart
   * pour un tour complet quand on la quitte. Sinon le film change sous la sélection et « Ma liste »
   * ou « Lecture » agit sur un autre film que celui que l'on regardait (vu par le banc sous Windows).
   */
  setHeld: (held: boolean) => void;
}

/**
 * Gère la rotation automatique du Hero Banner avec transitions fade.
 * Extrait de DashboardPage (Phase 3A.2).
 *
 * `paused` : accueil caché (fiche ouverte par-dessus, lecture en cours). La bannière n'est pas
 * visible, la faire tourner chargeait une nouvelle photo et redessinait toutes les 18 s pour rien,
 * pendant la vidéo comprise. Un tour complet au retour.
 */
export function useHeroRotation(heroMovies: HeroMovie[], paused = false): UseHeroRotationReturn {
  const [heroIndex, setHeroIndex] = useState(0);
  const [isFading, setIsFading] = useState(false);
  const rotationTimerRef = useRef<NodeJS.Timeout | null>(null);
  const fadeTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const heldRef = useRef(false);
  const pausedRef = useRef(paused);

  /** (Re)lance le compte à rebours du prochain film ; rien si un seul film ou bannière tenue. */
  const startInterval = useCallback(() => {
    if (rotationTimerRef.current) clearInterval(rotationTimerRef.current);
    rotationTimerRef.current = null;
    if (heroMovies.length <= 1 || heldRef.current || pausedRef.current) return;

    rotationTimerRef.current = setInterval(() => {
      setIsFading(true);
      fadeTimeoutRef.current = setTimeout(() => {
        setHeroIndex((prev) => (prev + 1) % heroMovies.length);
        setIsFading(false);
      }, 500); // Wait for fade out
    }, HERO_ROTATION_INTERVAL);
  }, [heroMovies.length]);

  const startRotationTimer = useCallback(() => {
    if (fadeTimeoutRef.current) clearTimeout(fadeTimeoutRef.current);
    startInterval();
  }, [startInterval]);

  useEffect(() => {
    startRotationTimer();
    return () => {
      if (rotationTimerRef.current) clearInterval(rotationTimerRef.current);
      if (fadeTimeoutRef.current) clearTimeout(fadeTimeoutRef.current);
    };
  }, [startRotationTimer]);

  // Accueil caché ou de nouveau visible : même arrêt et même reprise que la bannière tenue
  useEffect(() => {
    if (pausedRef.current === paused) return;
    pausedRef.current = paused;
    startInterval();
  }, [paused, startInterval]);

  // Nouvelle liste de films (rechargement) : retour au premier, ajusté pendant le rendu (pas d'image
  // intermédiaire avec un index hors de la nouvelle liste)
  const [shownMovies, setShownMovies] = useState(heroMovies);
  if (shownMovies !== heroMovies) {
    setShownMovies(heroMovies);
    setHeroIndex(0);
  }

  const handleDotClick = useCallback((index: number) => {
    if (index === heroIndex) return;
    if (fadeTimeoutRef.current) clearTimeout(fadeTimeoutRef.current);
    setIsFading(true);
    fadeTimeoutRef.current = setTimeout(() => {
      setHeroIndex(index);
      setIsFading(false);
      startRotationTimer(); // Reset the timer
    }, 500);
  }, [heroIndex, startRotationTimer]);

  const setHeld = useCallback((held: boolean) => {
    if (held === heldRef.current) return;
    heldRef.current = held;
    // Tenue : plus de prochain changement (un fondu déjà commencé va à son terme). Relâchée : un tour
    // complet avant le film suivant.
    startInterval();
  }, [startInterval]);

  return { heroIndex, isFading, handleDotClick, setHeld };
}
