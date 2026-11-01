/**
 * lazyPage — pages secondaires chargées à la demande et préchargeables.
 */

import React, { Suspense } from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { lazyPage, whenIdle } from '../lazyPage';

const Hello: React.FC<{ name: string }> = ({ name }) => <p>Bonjour {name}</p>;

function deferredModule() {
  let resolve!: () => void;
  const factory = vi.fn(
    () => new Promise<{ default: typeof Hello }>((r) => {
      resolve = () => r({ default: Hello });
    }),
  );
  return { factory, resolve: () => resolve() };
}

describe('lazyPage', () => {
  it("affiche l'attente puis la page une fois son bloc chargé", async () => {
    const { factory, resolve } = deferredModule();
    const Page = lazyPage(factory);
    render(
      <Suspense fallback={<p>attente</p>}>
        <Page name="Nyx" />
      </Suspense>,
    );
    expect(screen.getByText('attente')).toBeInTheDocument();
    await act(async () => {
      resolve();
    });
    expect(await screen.findByText('Bonjour Nyx')).toBeInTheDocument();
    expect(factory).toHaveBeenCalledTimes(1);
  });

  it("une page préchargée s'affiche tout de suite, sans passer par l'attente", async () => {
    const factory = vi.fn(() => Promise.resolve({ default: Hello }));
    const Page = lazyPage(factory);
    await Page.preload();
    render(
      <Suspense fallback={<p>attente</p>}>
        <Page name="TV" />
      </Suspense>,
    );
    expect(screen.getByText('Bonjour TV')).toBeInTheDocument();
    expect(screen.queryByText('attente')).not.toBeInTheDocument();
  });

  it('charge le bloc une seule fois, préchargement et affichage compris', async () => {
    const factory = vi.fn(() => Promise.resolve({ default: Hello }));
    const Page = lazyPage(factory);
    await Promise.all([Page.preload(), Page.preload()]);
    render(
      <Suspense fallback={null}>
        <Page name="x" />
      </Suspense>,
    );
    expect(factory).toHaveBeenCalledTimes(1);
  });

  it('un échec de chargement laisse réessayer le préchargement', async () => {
    const factory = vi.fn()
      .mockRejectedValueOnce(new Error('réseau'))
      .mockResolvedValueOnce({ default: Hello });
    const Page = lazyPage(factory);
    await expect(Page.preload()).rejects.toThrow('réseau');
    await expect(Page.preload()).resolves.toEqual({ default: Hello });
    expect(factory).toHaveBeenCalledTimes(2);
  });
});

describe('whenIdle', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("lance la tâche quand le navigateur est inactif, et s'annule", () => {
    const callbacks: Array<() => void> = [];
    vi.stubGlobal('requestIdleCallback', (cb: () => void) => callbacks.push(cb));
    const cancel = vi.fn();
    vi.stubGlobal('cancelIdleCallback', cancel);
    const task = vi.fn();
    const stop = whenIdle(task);
    expect(task).not.toHaveBeenCalled();
    callbacks[0]();
    expect(task).toHaveBeenCalledTimes(1);
    stop();
    expect(cancel).toHaveBeenCalledWith(1);
  });

  it('sans requestIdleCallback : repli sur un minuteur', () => {
    vi.useFakeTimers();
    vi.stubGlobal('requestIdleCallback', undefined);
    const task = vi.fn();
    whenIdle(task);
    vi.advanceTimersByTime(1000);
    expect(task).toHaveBeenCalledTimes(1);
  });
});
