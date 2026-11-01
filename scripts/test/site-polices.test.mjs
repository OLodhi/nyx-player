// @vitest-environment node
// Site (web/) : polices hébergées avec le site, aucune requête vers Google Fonts.
// Une page qui chargerait de nouveau une police externe enverrait l'adresse IP des visiteurs à un tiers,
// et la politique de sécurité (CSP) de vercel.json la bloquerait de toute façon.
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const web = fileURLToPath(new URL('../../web/', import.meta.url));

function files(dir) {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    return statSync(full).isDirectory() ? files(full) : [full];
  });
}

describe('site : polices', () => {
  it("aucune page ni feuille de style ne charge Google Fonts", () => {
    const texts = files(web).filter((f) => /\.(html|css|json)$/.test(f));
    const offenders = texts.filter((f) => /fonts\.(googleapis|gstatic)\.com/.test(readFileSync(f, 'utf8')));
    expect(offenders.map((f) => path.relative(web, f))).toEqual([]);
  });

  it('chaque police déclarée existe dans web/assets/fonts', () => {
    const css = readFileSync(path.join(web, 'styles.css'), 'utf8');
    const urls = [...css.matchAll(/url\('(assets\/fonts\/[^']+)'\)/g)].map((m) => m[1]);
    expect(urls.length).toBe(4);
    for (const url of urls) expect(existsSync(path.join(web, url)), url).toBe(true);
  });

  it('la CSP ne permet les polices que depuis le site', () => {
    const config = JSON.parse(readFileSync(path.join(web, 'vercel.json'), 'utf8'));
    const csps = config.headers.flatMap((h) => h.headers).filter((h) => h.key === 'Content-Security-Policy');
    expect(csps.length).toBeGreaterThan(0);
    for (const { value } of csps) {
      expect(value).toContain("font-src 'self'");
      expect(value).not.toMatch(/fonts\.(googleapis|gstatic)/);
    }
  });
});
