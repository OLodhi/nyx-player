/**
 * NyxDropdown — Composant dropdown custom réutilisable (Kit UI v2)
 *
 * Remplace les <select> natifs par un dropdown animé, stylable et accessible.
 * Animation : fade + slide (200ms). Panel : glassmorphism.
 * Fermeture : clic extérieur, Escape. Navigation clavier : Arrow/Enter.
 * Le panel est rendu via React Portal (document.body) pour éviter tout
 * problème de stacking context (backdrop-filter, overflow, z-index parents).
 *
 * Référence : BRAND_SYSTEM.md, DESIGN_TOKENS.md
 */

import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { useBackHandler } from '../../hooks/useBackHandler';
import { isTv } from '../../utils/platform';
import './NyxDropdown.css';

// ============================================================================
// TYPES
// ============================================================================
export interface NyxDropdownOption {
  value: string;
  label: string;
}

export interface NyxDropdownProps {
  /** Valeur sélectionnée */
  value: string;
  /** Callback au changement */
  onChange: (value: string) => void;
  /** Liste des options */
  options: NyxDropdownOption[];
  /** Désactive le dropdown */
  disabled?: boolean;
  /** Classe CSS additionnelle sur le wrapper */
  className?: string;
  /** ID pour les tests / accessibilité */
  id?: string;
  /** Repère du banc de test : le bouton le porte, la liste (toujours présente, ouverte avec la classe
   * `nyx-dropdown__panel--open`) « <repère>-list » */
  testId?: string;
}

// ============================================================================
// COMPONENT
// ============================================================================
const NyxDropdown: React.FC<NyxDropdownProps> = ({
  value,
  onChange,
  options,
  disabled = false,
  className,
  id,
  testId,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [focusedIndex, setFocusedIndex] = useState(-1);
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  // Retour (Android, télécommande) : ferme la liste ouverte avant tout le reste
  useBackHandler(isOpen, () => setIsOpen(false));

  // Position calculée pour le portal
  const [panelPos, setPanelPos] = useState({ top: 0, left: 0, width: 0 });

  // Compute selected label
  const selectedLabel = useMemo(() => {
    const found = options.find((opt) => opt.value === value);
    return found ? found.label : '';
  }, [value, options]);

  // Calcul de la position du panel par rapport au trigger
  const updatePosition = useCallback(() => {
    if (!triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    setPanelPos({
      top: rect.bottom + 4, // 4px de gap sous le trigger
      left: rect.left,
      width: rect.width,
    });
  }, []);

  // Toggle open
  const handleToggle = useCallback(() => {
    if (disabled) return;
    setIsOpen((prev) => {
      if (!prev) {
        const idx = options.findIndex((opt) => opt.value === value);
        setFocusedIndex(idx >= 0 ? idx : 0);
      }
      return !prev;
    });
  }, [disabled, options, value]);

  // Select an option
  const handleSelect = useCallback(
    (optionValue: string) => {
      onChange(optionValue);
      setIsOpen(false);
    },
    [onChange],
  );

  // Mise à jour position à l'ouverture + suivi scroll/resize
  useEffect(() => {
    if (!isOpen) return;
    updatePosition();

    // Recalculer si la page scroll ou resize. Écoute en capture sur le document : tout défilement
    // d'un ancêtre est vu, y compris celui lancé juste après l'ouverture (télécommande qui centre la
    // sélection) ; la liste s'affichait sinon décalée, par-dessus le sélecteur.
    document.addEventListener('scroll', updatePosition, true);
    window.addEventListener('resize', updatePosition);

    return () => {
      document.removeEventListener('scroll', updatePosition, true);
      window.removeEventListener('resize', updatePosition);
    };
  }, [isOpen, updatePosition]);

  // Close on outside click — vérifie trigger ET panel (portal)
  useEffect(() => {
    if (!isOpen) return;
    const handleMouseDown = (e: MouseEvent) => {
      const target = e.target as Node;
      const inContainer = containerRef.current?.contains(target);
      const inPanel = panelRef.current?.contains(target);
      if (!inContainer && !inPanel) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleMouseDown);
    return () => document.removeEventListener('mousedown', handleMouseDown);
  }, [isOpen]);

  // Keyboard navigation
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (disabled) return;

      switch (e.key) {
        case 'Escape':
          // Liste fermée : la touche passe à la navigation (Retour quitte la page). La retenir
          // laissait le premier Retour sans effet quand le focus était sur le sélecteur.
          if (!isOpen) break;
          e.preventDefault();
          setIsOpen(false);
          break;
        case 'Enter':
        case ' ':
          e.preventDefault();
          if (!isOpen) {
            setIsOpen(true);
            const idx = options.findIndex((opt) => opt.value === value);
            setFocusedIndex(idx >= 0 ? idx : 0);
          } else if (focusedIndex >= 0 && focusedIndex < options.length) {
            handleSelect(options[focusedIndex].value);
          }
          break;
        case 'ArrowDown':
          // Télécommande : passer sur la liste ne l'ouvre pas, seul OK l'ouvre ; la flèche continue le parcours
          if (!isOpen && isTv()) break;
          e.preventDefault();
          if (!isOpen) {
            setIsOpen(true);
            const idx = options.findIndex((opt) => opt.value === value);
            setFocusedIndex(idx >= 0 ? idx : 0);
          } else {
            setFocusedIndex((prev) => (prev < options.length - 1 ? prev + 1 : prev));
          }
          break;
        case 'ArrowUp':
          if (!isOpen && isTv()) break;
          e.preventDefault();
          if (isOpen) {
            setFocusedIndex((prev) => (prev > 0 ? prev - 1 : prev));
          }
          break;
        case 'ArrowLeft':
        case 'ArrowRight':
          // Liste ouverte : la télécommande ne doit pas emmener le focus ailleurs
          if (isOpen) e.preventDefault();
          break;
      }
    },
    [disabled, isOpen, focusedIndex, options, value, handleSelect],
  );

  // Scroll focused item into view
  useEffect(() => {
    if (!isOpen || focusedIndex < 0 || !panelRef.current) return;
    const items = panelRef.current.querySelectorAll('.nyx-dropdown__item');
    if (items[focusedIndex] && typeof items[focusedIndex].scrollIntoView === 'function') {
      items[focusedIndex].scrollIntoView({ block: 'nearest' });
    }
  }, [isOpen, focusedIndex]);

  // Build class names
  const rootCls = [
    'nyx-dropdown',
    isOpen && 'nyx-dropdown--open',
    disabled && 'nyx-dropdown--disabled',
    className,
  ]
    .filter(Boolean)
    .join(' ');

  const listboxId = id ? `${id}-listbox` : undefined;

  // Panel rendu via Portal dans document.body
  const panelContent = (
    <div
      className={`nyx-dropdown__panel ${isOpen ? 'nyx-dropdown__panel--open' : ''}`}
      role="listbox"
      id={listboxId}
      data-testid={testId ? `${testId}-list` : undefined}
      ref={panelRef}
      style={{
        position: 'fixed',
        top: panelPos.top,
        left: panelPos.left,
        width: panelPos.width,
      }}
      aria-activedescendant={
        isOpen && focusedIndex >= 0
          ? `nyx-dropdown-opt-${focusedIndex}`
          : undefined
      }
    >
      {options.map((opt, idx) => {
        const isActive = opt.value === value;
        const isFocused = idx === focusedIndex;
        const itemCls = [
          'nyx-dropdown__item',
          isActive && 'nyx-dropdown__item--active',
          isFocused && 'nyx-dropdown__item--focused',
        ]
          .filter(Boolean)
          .join(' ');

        return (
          <div
            key={opt.value}
            id={`nyx-dropdown-opt-${idx}`}
            className={itemCls}
            role="option"
            aria-selected={isActive}
            data-value={opt.value}
            onClick={() => handleSelect(opt.value)}
            onMouseEnter={() => setFocusedIndex(idx)}
          >
            <span className="nyx-dropdown__item-label">{opt.label}</span>
            {isActive && (
              <span className="nyx-dropdown__item-check" aria-hidden="true">
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                  <path d="M3 7L6 10L11 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </span>
            )}
          </div>
        );
      })}
    </div>
  );

  return (
    <div className={rootCls} ref={containerRef} onKeyDown={handleKeyDown}>
      <button
        type="button"
        className="nyx-dropdown__trigger"
        ref={triggerRef}
        onClick={handleToggle}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        aria-controls={listboxId}
        id={id}
        data-testid={testId}
        data-value={value}
      >
        <span className="nyx-dropdown__value">{selectedLabel}</span>
        <span className="nyx-dropdown__chevron" aria-hidden="true">
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
            <path d="M3 4.5L6 7.5L9 4.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>
      </button>

      {createPortal(panelContent, document.body)}
    </div>
  );
};

// ============================================================================
// HELPERS
// ============================================================================

export default NyxDropdown;
