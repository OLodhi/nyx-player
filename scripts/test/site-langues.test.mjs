// @vitest-environment node
// Site (web/) : anglais par défaut, bouton EN | FR dans la barre du haut de chaque page.
// Le bouton est fait de simples liens vers la page jumelle (aucun script, la CSP de vercel.json
// reste inchangée). Une page sans version française montre « FR » grisé, sans lien.
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const web = fileURLToPath(new URL('../../web/', import.meta.url));
// Pages du site (les pages de auth/ et les modèles d'e-mails ne sont pas concernés).
const pages = readdirSync(web).filter((f) => f.endsWith('.html'));
const read = (page) => readFileSync(path.join(web, page), 'utf8');
const htmlLang = (text) => text.match(/<html lang="([a-z]+)"[^>]*>/)?.[1];

function langSwitch(text) {
  const block = text.match(/<div class="lang-switch"[^>]*>([\s\S]*?)\n\s*<\/div>/)?.[1];
  if (!block) return null;
  const options = [...block.matchAll(/<(a|span) ([^>]*)>(EN|FR)(?:<span class="visually-hidden">([^<]*)<\/span>)?<\/\1>/g)].map(([, tag, attrs, label, hint]) => ({
    tag,
    label,
    href: attrs.match(/href="([^"]+)"/)?.[1],
    current: attrs.includes('lang-switch__option--current'),
    unavailable: attrs.includes('lang-switch__option--unavailable'),
    // Texte lu par les lecteurs d'écran seulement : « bientôt disponible » (le grisé ne s'entend pas).
    hint: hint?.trim(),
  }));
  return options;
}

describe('site : choix de la langue', () => {
  it('chaque page a un bouton EN | FR dans sa barre du haut, langue de la page sélectionnée', () => {
    expect(pages.length).toBeGreaterThan(5);
    for (const page of pages) {
      const text = read(page);
      const options = langSwitch(text);
      expect(options, page).not.toBeNull();
      expect(options.map((o) => o.label), page).toEqual(['EN', 'FR']);
      const current = options.filter((o) => o.current);
      expect(current.length, page).toBe(1);
      expect(current[0].label.toLowerCase(), page).toBe(htmlLang(text));
      expect(current[0].tag, page).toBe('span');
    }
  });

  it("l'anglais est la langue par défaut : toute page française a sa jumelle anglaise", () => {
    const french = pages.filter((p) => htmlLang(read(p)) === 'fr');
    expect(french).toEqual(expect.arrayContaining(['confidentialite.html', 'mentions-legales.html', 'assistance.html', 'conditions.html']));
    for (const page of french) {
      const en = langSwitch(read(page)).find((o) => o.label === 'EN');
      expect(en.tag, page).toBe('a');
    }
  });

  it('chaque lien du bouton mène à la page jumelle, qui renvoie vers la page de départ', () => {
    for (const page of pages) {
      for (const option of langSwitch(read(page)).filter((o) => o.tag === 'a')) {
        expect(existsSync(path.join(web, option.href)), `${page} → ${option.href}`).toBe(true);
        const twin = read(option.href);
        expect(htmlLang(twin), option.href).toBe(option.label.toLowerCase());
        const back = langSwitch(twin).find((o) => o.tag === 'a');
        expect(back?.href, `${option.href} → ${page}`).toBe(page);
      }
    }
  });

  it("un « FR » sans lien est marqué indisponible (en attendant la version française d'une page)", () => {
    for (const page of pages) {
      for (const option of langSwitch(read(page)).filter((o) => o.tag === 'span' && !o.current)) {
        expect(option.unavailable, page).toBe(true);
        expect(option.hint, page).toMatch(/bientôt disponible/);
      }
    }
  });

  it('les pages jumelles se déclarent l’une l’autre aux moteurs de recherche (hreflang)', () => {
    for (const page of pages) {
      const text = read(page);
      const twin = langSwitch(text).find((o) => o.tag === 'a');
      if (!twin) continue;
      const lang = htmlLang(text);
      const [fr, en] = lang === 'fr' ? [page, twin.href] : [twin.href, page];
      expect(text, page).toContain(`hreflang="fr" href="https://nyxplayer.app/${fr}"`);
      expect(text, page).toContain(`hreflang="en" href="https://nyxplayer.app/${en}"`);
      expect(text, page).toContain(`hreflang="x-default" href="https://nyxplayer.app/${en}"`);
    }
  });

  it('les pages françaises ne renvoient pas vers les versions anglaises quand une version française existe', () => {
    const twins = { 'privacy.html': 'confidentialite.html', 'legal.html': 'mentions-legales.html', 'contact.html': 'assistance.html', 'terms.html': 'conditions.html' };
    for (const page of pages.filter((p) => htmlLang(read(p)) === 'fr')) {
      const text = read(page).replace(/<div class="lang-switch"[\s\S]*?<\/div>/, '');
      for (const en of Object.keys(twins)) {
        expect(text.includes(`href="${en}"`), `${page} pointe vers ${en} au lieu de ${twins[en]}`).toBe(false);
      }
    }
  });
});
