// @vitest-environment node
// Site (web/) : chaque lien interne mène à un fichier qui existe, et chaque ancre (#faq) à un id de la
// page visée. Sont lus : href, src et srcset des pages, des pages de auth/ et des modèles d'e-mails,
// et les url(...) de styles.css (les scripts de auth/ n'écrivent aucune adresse). Un lien absolu vers
// https://nyxplayer.app/ compte comme interne ; les autres sites ne sont pas suivis (pas de réseau).
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const web = fileURLToPath(new URL('../../web/', import.meta.url));
const SITE = 'https://nyxplayer.app';
// Fichier servi par Vercel lui-même (statistiques de visite), absent du dépôt.
const SERVIS_PAR_VERCEL = new Set(['/_vercel/insights/script.js']);

function fichiers(dossier, ext) {
  return readdirSync(dossier).flatMap((f) => {
    const p = path.join(dossier, f);
    if (statSync(p).isDirectory()) return fichiers(p, ext);
    return ext.includes(path.extname(f)) ? [p] : [];
  });
}
const rel = (p) => path.relative(web, p).split(path.sep).join('/');

/** Adresses d'une page : attributs href, src, srcset. */
function adressesHtml(texte) {
  const out = [];
  for (const [, attr, valeur] of texte.matchAll(/\s(href|src|srcset)="([^"]*)"/g)) {
    if (attr === 'srcset') out.push(...valeur.split(',').map((v) => v.trim().split(/\s+/)[0]).filter(Boolean));
    else out.push(valeur);
  }
  return out;
}

/**
 * Chemin dans web/ d'une adresse interne vue depuis `depuis` (chemin relatif à web/), ou null pour une
 * adresse externe ou sans fichier (mailto:, tel:, javascript:).
 */
function cible(adresse, depuis) {
  let a = adresse.replace(/^\{\{ *\.SiteURL *\}\}/, SITE);
  if (/^(mailto|tel|javascript|data):/i.test(a)) return null;
  if (a.startsWith(SITE)) a = a.slice(SITE.length) || '/';
  else if (/^[a-z][a-z0-9+.-]*:|^\/\//i.test(a)) return null;
  const [sansAncre, ancre = ''] = a.split('#');
  const chemin = sansAncre.split('?')[0];
  let fichier;
  if (chemin === '') fichier = depuis; // « #faq » : la page elle-même
  else if (chemin.startsWith('/')) fichier = chemin.slice(1);
  else fichier = path.posix.normalize(path.posix.join(path.posix.dirname(depuis), chemin));
  if (fichier === '' || fichier.endsWith('/')) fichier += 'index.html';
  return { fichier, ancre, brut: chemin.startsWith('/') ? chemin : null };
}

const ids = (texte) => new Set([...texte.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]));

const pages = fichiers(web, ['.html']);
const liens = [];
for (const p of pages) for (const a of adressesHtml(readFileSync(p, 'utf8'))) liens.push({ depuis: rel(p), adresse: a });
for (const p of fichiers(web, ['.css'])) {
  for (const [, , a] of readFileSync(p, 'utf8').matchAll(/url\((['"]?)([^'")]+)\1\)/g)) liens.push({ depuis: rel(p), adresse: a });
}

describe('site : liens internes', () => {
  it('trouve bien les liens du site (le test ne tourne pas à vide)', () => {
    expect(pages.length).toBeGreaterThanOrEqual(10);
    expect(liens.filter((l) => cible(l.adresse, l.depuis)).length).toBeGreaterThan(100);
  });

  it('chaque lien interne mène à un fichier du site', () => {
    const casses = [];
    for (const { depuis, adresse } of liens) {
      const c = cible(adresse, depuis);
      if (!c || (c.brut && SERVIS_PAR_VERCEL.has(c.brut))) continue;
      const p = path.join(web, c.fichier);
      if (!p.startsWith(web) || !existsSync(p) || !statSync(p).isFile()) casses.push(`${depuis} → ${adresse}`);
    }
    expect(casses).toEqual([]);
  });

  it('chaque ancre mène à un id de la page visée', () => {
    const casses = [];
    for (const { depuis, adresse } of liens) {
      const c = cible(adresse, depuis);
      if (!c?.ancre || !c.fichier.endsWith('.html')) continue;
      const p = path.join(web, c.fichier);
      if (!existsSync(p) || !ids(readFileSync(p, 'utf8')).has(c.ancre)) casses.push(`${depuis} → ${adresse}`);
    }
    expect(casses).toEqual([]);
  });

  it('résout les adresses comme le navigateur', () => {
    expect(cible('privacy.html', 'index.html')).toMatchObject({ fichier: 'privacy.html' });
    expect(cible('../styles.css', 'auth/confirm.html')).toMatchObject({ fichier: 'styles.css' });
    expect(cible('/', 'auth/confirm.html')).toMatchObject({ fichier: 'index.html' });
    expect(cible('/#faq', 'legal.html')).toMatchObject({ fichier: 'index.html', ancre: 'faq' });
    expect(cible('#faq', 'index.html')).toMatchObject({ fichier: 'index.html', ancre: 'faq' });
    expect(cible('https://nyxplayer.app/terms.html', 'emails/recovery.html')).toMatchObject({ fichier: 'terms.html' });
    expect(cible('{{ .SiteURL }}/auth/confirm.html?token_hash={{ .TokenHash }}', 'emails/confirmation.html')).toMatchObject({ fichier: 'auth/confirm.html' });
    expect(cible('https://reddit.com/r/nyxplayer', 'index.html')).toBeNull();
    expect(cible('mailto:contact@nyxplayer.app', 'index.html')).toBeNull();
  });
});
