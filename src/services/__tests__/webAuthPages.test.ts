/**
 * Pages d'authentification du site (web/auth) : une seule source pour l'adresse et la clé publique
 * de Supabase (supabase-config.js), pour que le passage aux nouvelles clés ne demande qu'une
 * ligne ; et la même longueur minimale de mot de passe que l'app.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { MIN_PASSWORD_LENGTH } from '../../utils/passwordPolicy';

const root = resolve(__dirname, '../../../web/auth');
const read = (name: string) => readFileSync(resolve(root, name), 'utf8');
const PAGES = ['confirm.html', 'email-change.html', 'reset-password.html'];

describe("pages d'authentification du site", () => {
  it.each(PAGES)('%s lit la clé dans supabase-config.js, chargé avant son script', (page) => {
    const html = read(page);
    const config = html.indexOf('<script src="/auth/supabase-config.js"></script>');
    expect(config).toBeGreaterThan(-1);
    expect(html.indexOf('window.NYX_SUPABASE.key')).toBeGreaterThan(config);
    // Aucune clé écrite en dur dans la page
    expect(html).not.toMatch(/eyJ[A-Za-z0-9_-]{10,}/);
    expect(html).not.toMatch(/sb_publishable_/);
  });

  // Ces pages portent un jeton dans l'adresse ; la mesure d'audience n'y
  // est pas chargée, et le script qui retire le jeton passe avant celui de la page.
  it.each(PAGES)('%s ne charge pas la mesure d\'audience, et retire le jeton avant tout', (page) => {
    const html = read(page);
    expect(html).not.toMatch(/_vercel\/insights|vercel-insights|va\.vercel/i);
    const session = html.indexOf('<script src="/auth/session.js"></script>');
    expect(session).toBeGreaterThan(-1);
    const inline = html.indexOf('<script>', session);
    expect(html.indexOf('NyxAuthSession.takeLinkParams(window)')).toBeGreaterThan(inline);
    expect(html).not.toContain('new URLSearchParams(window.location.search)');
  });

  it('supabase-config.js donne une adresse https du projet et une clé', () => {
    const config = read('supabase-config.js');
    expect(config).toMatch(/url: 'https:\/\/[a-z0-9]{20}\.supabase\.co'/);
    expect(config).toMatch(/key: '(eyJ[A-Za-z0-9._-]+|sb_publishable_[A-Za-z0-9_-]+)'/);
  });

  it('« mot de passe oublié » demande la même longueur que l\'app', () => {
    const html = read('reset-password.html');
    // Une seule constante dans la page : champs, texte d'aide et vérification la lisent (le
    // comportement est vérifié dans scripts/test/site-comptes-langues.test.mjs).
    expect(html).toContain(`const MIN_PASSWORD = ${MIN_PASSWORD_LENGTH};`);
    expect(html).toContain('password.length < MIN_PASSWORD');
  });
});
