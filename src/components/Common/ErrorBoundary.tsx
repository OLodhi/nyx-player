/**
 * ErrorBoundary — Composant de résilience React
 *
 * Attrape les erreurs JS dans ses enfants et affiche un fallback UI
 * au lieu de crasher toute l'application.
 *
 * Class component car getDerivedStateFromError + componentDidCatch
 * ne sont pas disponibles via hooks.
 */

import React from 'react';
import { useTranslation } from 'react-i18next';
import * as Sentry from '@sentry/react';
import logoPrincipalBlanc from '../../assets/brand/logo-principal-blanc.svg';
import './ErrorBoundary.css';
import { createLogger } from '../../utils/logger';

interface ErrorBoundaryProps {
  /** Identifiant de la zone protégée (ex: "Player", "Dashboard") */
  context: string;
  /** Override du fallback par défaut */
  fallback?: React.ReactNode;
  /**
   * Sortie de la zone en erreur (fermer le lecteur, quitter la fiche) : un second bouton à côté de
   * « Réessayer », sinon rien ne permettait de sortir d'une erreur pendant la lecture
   */
  onClose?: () => void;
  /** Texte du bouton de sortie (défaut : « Retour ») */
  closeLabel?: string;
  children: React.ReactNode;
}

interface ErrorFallbackProps {
  context: string;
  error: Error | null;
  onRetry: () => void;
  onClose?: () => void;
  closeLabel?: string;
}

/** Écran par défaut, traduit (composant fonction : la classe ne peut pas utiliser useTranslation) */
const ErrorFallback: React.FC<ErrorFallbackProps> = ({ context, error, onRetry, onClose, closeLabel }) => {
  const { t } = useTranslation('common');
  return (
    <div className="error-boundary" role="alert">
      <div className="error-boundary__content">
        <img
          src={logoPrincipalBlanc}
          alt="Nyx Player"
          className="error-boundary__logo"
        />
        <h2 className="error-boundary__title">
          {t('error_boundary_title')}
        </h2>
        <p className="error-boundary__subtitle">
          {t('error_boundary_subtitle')}
        </p>
        {import.meta.env.DEV && error && (
          <p className="error-boundary__message">
            [{context}] {error.message}
          </p>
        )}
        <div className="error-boundary__actions">
          <button
            type="button"
            className="error-boundary__retry"
            onClick={onRetry}
          >
            {t('error_boundary_retry')}
          </button>
          {onClose && (
            <button
              type="button"
              className="error-boundary__retry"
              onClick={onClose}
            >
              {closeLabel ?? t('error_boundary_back')}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  override componentDidCatch(error: Error, errorInfo: React.ErrorInfo): void {
    createLogger(`ErrorBoundary:${this.props.context}`).error('Erreur de rendu', error, errorInfo.componentStack);

    Sentry.captureException(error, {
      extra: {
        context: this.props.context,
        componentStack: errorInfo.componentStack,
      },
    });
  }

  handleReset = (): void => {
    this.setState({ hasError: false, error: null });
  };

  /** Le parent retire la zone (lecteur fermé, fiche quittée) : l'écran d'erreur part avec elle */
  handleClose = (): void => {
    this.props.onClose?.();
  };

  override render(): React.ReactNode {
    if (!this.state.hasError) {
      return this.props.children;
    }

    // Fallback custom si fourni
    if (this.props.fallback) {
      return this.props.fallback;
    }

    // Fallback par défaut
    return (
      <ErrorFallback
        context={this.props.context}
        error={this.state.error}
        onRetry={this.handleReset}
        onClose={this.props.onClose ? this.handleClose : undefined}
        closeLabel={this.props.closeLabel}
      />
    );
  }
}

export default ErrorBoundary;
