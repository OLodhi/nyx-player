import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import i18n from '../../../i18n/config';
import ErrorBoundary from '../ErrorBoundary';

beforeAll(async () => {
  await i18n.changeLanguage('fr');
});

// Composant qui throw pour tester le boundary
const ThrowingComponent = ({ shouldThrow }: { shouldThrow: boolean }) => {
  if (shouldThrow) {
    throw new Error('Test crash');
  }
  return <div data-testid="child">Contenu normal</div>;
};

// Supprimer les console.error pendant les tests (React log les erreurs de boundary)
const originalConsoleError = console.error;
beforeEach(() => {
  console.error = vi.fn();
});
afterEach(() => {
  console.error = originalConsoleError;
});

describe('ErrorBoundary', () => {
  it('rend les enfants normalement quand il n\'y a pas d\'erreur', () => {
    render(
      <ErrorBoundary context="Test">
        <ThrowingComponent shouldThrow={false} />
      </ErrorBoundary>
    );

    expect(screen.getByTestId('child')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('affiche le fallback quand un enfant throw', () => {
    render(
      <ErrorBoundary context="Dashboard">
        <ThrowingComponent shouldThrow={true} />
      </ErrorBoundary>
    );

    expect(screen.queryByTestId('child')).not.toBeInTheDocument();
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByText(/une erreur est survenue/i)).toBeInTheDocument();
  });

  it('affiche le context dans le fallback', () => {
    render(
      <ErrorBoundary context="Player">
        <ThrowingComponent shouldThrow={true} />
      </ErrorBoundary>
    );

    expect(screen.getByText(/Player/)).toBeInTheDocument();
  });

  it('reset le state quand on clique sur Réessayer', () => {
    const { rerender } = render(
      <ErrorBoundary context="Test">
        <ThrowingComponent shouldThrow={true} />
      </ErrorBoundary>
    );

    // Le fallback est affiché
    expect(screen.getByRole('alert')).toBeInTheDocument();

    // On re-render avec shouldThrow=false AVANT de cliquer reset
    // pour que le re-render après reset ne re-throw pas
    rerender(
      <ErrorBoundary context="Test">
        <ThrowingComponent shouldThrow={false} />
      </ErrorBoundary>
    );

    // Cliquer sur Réessayer
    fireEvent.click(screen.getByText('Réessayer'));

    // Le fallback disparaît, le contenu normal s'affiche
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByTestId('child')).toBeInTheDocument();
  });

  it('affiche un fallback custom quand la prop fallback est fournie', () => {
    render(
      <ErrorBoundary context="Test" fallback={<div data-testid="custom-fallback">Custom</div>}>
        <ThrowingComponent shouldThrow={true} />
      </ErrorBoundary>
    );

    expect(screen.getByTestId('custom-fallback')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it("est traduit : en anglais, plus de texte français codé en dur", async () => {
    await i18n.changeLanguage('en');
    try {
      render(
        <ErrorBoundary context="Test">
          <ThrowingComponent shouldThrow={true} />
        </ErrorBoundary>
      );
      expect(screen.getByText('Something went wrong')).toBeInTheDocument();
      expect(screen.getByText('Try again')).toBeInTheDocument();
      expect(screen.queryByText(/une erreur est survenue/i)).not.toBeInTheDocument();
    } finally {
      await i18n.changeLanguage('fr');
    }
  });

  it('sans onClose, seul « Réessayer » est proposé', () => {
    render(
      <ErrorBoundary context="Test">
        <ThrowingComponent shouldThrow={true} />
      </ErrorBoundary>
    );
    expect(screen.getAllByRole('button')).toHaveLength(1);
  });

  it('propose de fermer le lecteur et appelle onClose', () => {
    const onClose = vi.fn();
    render(
      <ErrorBoundary context="Player" onClose={onClose} closeLabel="Fermer le lecteur">
        <ThrowingComponent shouldThrow={true} />
      </ErrorBoundary>
    );
    fireEvent.click(screen.getByText('Fermer le lecteur'));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('bouton de sortie « Retour » par défaut', () => {
    render(
      <ErrorBoundary context="MovieDetail" onClose={() => {}}>
        <ThrowingComponent shouldThrow={true} />
      </ErrorBoundary>
    );
    expect(screen.getByText('Retour')).toBeInTheDocument();
  });
});
