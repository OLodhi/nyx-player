/**
 * Mise à jour Windows : la vérification passe par la commande de l'app, sans option venue de la
 * page (le greffon acceptait un retour en arrière, un proxy, des en-têtes ou une autre cible).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ invoke }));
vi.mock('@tauri-apps/plugin-updater', () => ({
  Update: class {
    rid: number;
    version: string;
    constructor(metadata: { rid: number; version: string }) {
      this.rid = metadata.rid;
      this.version = metadata.version;
    }
  },
}));

import { checkForAppUpdate } from '../appUpdateCheck';

const SRC = resolve(__dirname, '../..');
function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === '__tests__' ? [] : sourceFiles(path);
    return /\.(ts|tsx)$/.test(name) ? [path] : [];
  });
}

beforeEach(() => invoke.mockReset());

describe('checkForAppUpdate', () => {
  it('demande à l\'app, sans aucune option', async () => {
    invoke.mockResolvedValueOnce(null);
    expect(await checkForAppUpdate()).toBeNull();
    expect(invoke).toHaveBeenCalledWith('nyx_update_check');
  });

  it('mise à jour proposée : objet du greffon, pour le téléchargement', async () => {
    invoke.mockResolvedValueOnce({ rid: 7, currentVersion: '0.7.6', version: '0.8.0', rawJson: {} });
    const update = await checkForAppUpdate();
    expect(update).toMatchObject({ rid: 7, version: '0.8.0' });
  });

  it('plus aucun appel à la vérification du greffon dans src', () => {
    const fautifs = sourceFiles(SRC).filter((file) =>
      /import\s*\{[^}]*\bcheck\b[^}]*\}\s*from\s*['"]@tauri-apps\/plugin-updater['"]/.test(readFileSync(file, 'utf8')),
    );
    expect(fautifs).toEqual([]);
  });
});
