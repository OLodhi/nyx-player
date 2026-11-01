/**
 * NyxButton — Composant bouton réutilisable (Kit UI v2)
 *
 * Variantes : primary (fill) | secondary (outline)
 * Tailles   : medium | small
 * Couleurs  : blue | blue-light | red
 *
 * Référence : BRAND_SYSTEM.md §3, DESIGN_TOKENS.md §2
 */

import React from 'react';
import './NyxButton.css';

export type NyxButtonVariant = 'primary' | 'secondary';
export type NyxButtonSize = 'md' | 'sm' | 'xs';
export type NyxButtonColor = 'blue' | 'blue-light' | 'red';

export interface NyxButtonProps
  extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'color'> {
  /** Fill vs outline. @default 'primary' */
  variant?: NyxButtonVariant;
  /** Medium vs small. @default 'medium' */
  size?: NyxButtonSize;
  /** Couleur thème. @default 'blue' */
  color?: NyxButtonColor;
  /** Icône à gauche du label */
  iconLeft?: React.ReactNode;
  /** Icône à droite du label */
  iconRight?: React.ReactNode;
}

const NyxButton: React.FC<NyxButtonProps> = ({
  variant = 'primary',
  size = 'medium',
  color = 'blue',
  iconLeft,
  iconRight,
  className,
  children,
  type = 'button',
  ...rest
}) => {
  const cls = [
    'nyx-btn',
    `nyx-btn--${variant}`,
    `nyx-btn--${size}`,
    `nyx-btn--${color}`,
    className,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <button type={type} className={cls} {...rest}>
      {iconLeft && <span className="nyx-btn__icon nyx-btn__icon--left">{iconLeft}</span>}
      <span className="nyx-btn__label">{children}</span>
      {iconRight && <span className="nyx-btn__icon nyx-btn__icon--right">{iconRight}</span>}
    </button>
  );
};

export default NyxButton;
