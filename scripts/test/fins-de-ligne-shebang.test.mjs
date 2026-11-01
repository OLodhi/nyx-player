// @vitest-environment node
// Scripts Node qui commencent par « #!/usr/bin/env node » : extraits en CRLF sous Windows
// (core.autocrlf), Vitest ne sait plus les charger (SyntaxError) et tous les tests qui les importent
// échouent, sur le PC seulement.
// Règle : pas de ligne « #! » sur un script lancé par « node … » ;
// là où elle est nécessaire, .gitattributes garde le fichier en LF.
import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const racine = fileURLToPath(new URL('../../', import.meta.url));
const git = (...args) => execFileSync('git', ['-C', racine, ...args], { encoding: 'utf8' });

const scripts = git('ls-files', '-z', '--', '*.mjs').split('\0').filter(Boolean)
  .filter((f) => readFileSync(path.join(racine, f), 'utf8').startsWith('#!'));

describe('scripts Node avec une ligne « #! »', () => {
  it('seulement là où elle sert : garde-fous de Claude et commande « vigie »', () => {
    // Commande « vigie » de l'outil d'audit : absente d'une copie publique du dépôt
    const vigie = existsSync(path.join(racine, 'audit/cli.mjs')) ? ['audit/cli.mjs'] : [];
    expect(scripts.filter((f) => !f.startsWith('.claude/hooks/'))).toEqual(vigie);
    // Garde-fous de Claude Code : absents d'une copie publique du dépôt
    if (existsSync(path.join(racine, '.claude/hooks/garde-fous.mjs'))) expect(scripts).toContain('.claude/hooks/garde-fous.mjs');
  });

  it.each(scripts)('%s : gardé en LF par .gitattributes', (fichier) => {
    expect(git('check-attr', 'eol', '--', fichier).trim()).toBe(`${fichier}: eol: lf`);
  });
});
