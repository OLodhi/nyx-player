// @vitest-environment node
// Pages de compte du site (web/auth/, cibles des e-mails Supabase) en anglais et en français.
// Langue du navigateur (ou ?lang=), bouton EN | FR qui change les textes sans recharger la page
// (le jeton du lien est à usage unique), minimum de mot de passe de 10 caractères.
// Les pages tournent dans jsdom avec leur vrai script ; l'appel à Supabase est simulé.
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

const auth = fileURLToPath(new URL('../../web/auth/', import.meta.url));
const langScript = readFileSync(`${auth}langue.js`, 'utf8');
const configScript = readFileSync(`${auth}supabase-config.js`, 'utf8');
const sessionScript = existsSync(`${auth}session.js`) ? readFileSync(`${auth}session.js`, 'utf8') : '';
const PAGES = { confirm: 'confirm.html', 'email-change': 'email-change.html', reset: 'reset-password.html' };

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

/** Ouvre une page dans jsdom. `answer` : réponse simulée de Supabase ({ ok, body }). */
async function open(file, { query = '?token_hash=abc', languages = ['en-US'], answer = { ok: true, body: {} } } = {}) {
  const html = readFileSync(`${auth}${file}`, 'utf8')
    .replace('<script src="/auth/langue.js"></script>', () => `<script>${langScript}</script>`)
    .replace('<script src="/auth/supabase-config.js"></script>', () => `<script>${configScript}</script>`)
    .replace('<script src="/auth/session.js"></script>', () => `<script>${sessionScript}</script>`)
    .replace(/<script defer src="\/_vercel[^>]*><\/script>/, '');
  const calls = [];
  const dom = new JSDOM(html, {
    url: `https://nyxplayer.app/auth/${file}${query}`,
    runScripts: 'dangerously',
    beforeParse(window) {
      Object.defineProperty(window.navigator, 'languages', { value: languages });
      // Une réponse, ou une liste de réponses données dans l'ordre des appels.
      const answers = Array.isArray(answer) ? [...answer] : null;
      window.fetch = async (url, init) => {
        calls.push({ url, init });
        const next = answers ? answers.shift() : answer;
        return { ok: next.ok, json: async () => next.body };
      };
    },
  });
  await flush();
  await flush();
  const { document } = dom.window;
  const $ = (sel) => document.querySelector(sel);
  const visible = (id) => !$(`#${id}`).classList.contains('hidden');
  const click = async (el) => {
    el.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
    await flush();
    await flush();
  };
  return { dom, document, $, visible, click, calls };
}

const TEXTS = () => {
  const dom = new JSDOM('', { runScripts: 'outside-only' });
  dom.window.eval(langScript);
  return dom.window.NyxAuthLang.TEXTS;
};

describe('pages de compte : anglais et français', () => {
  it('chaque texte existe dans les deux langues, et chaque clé de la page est traduite', () => {
    const texts = TEXTS();
    for (const group of Object.keys(texts)) {
      expect(Object.keys(texts[group].fr).sort(), group).toEqual(Object.keys(texts[group].en).sort());
    }
    for (const [page, file] of Object.entries(PAGES)) {
      const html = readFileSync(`${auth}${file}`, 'utf8');
      expect(html, file).toContain(`data-page="${page}"`);
      const keys = [...html.matchAll(/data-i18n(?:-placeholder)?="([^"]+)"/g)].map((m) => m[1]);
      expect(keys.length, file).toBeGreaterThan(3);
      for (const key of [...keys, 'title']) {
        const fr = texts[page].fr[key] ?? texts.common.fr[key];
        expect(fr, `${file} : ${key}`).toBeTruthy();
      }
    }
  });

  it('navigateur en français : la page s’affiche en français ; autre langue : en anglais', async () => {
    for (const file of Object.values(PAGES)) {
      const fr = await open(file, { languages: ['fr-FR', 'en'] });
      expect(fr.document.documentElement.lang, file).toBe('fr');
      expect(fr.$('.subtitle').textContent, file).toMatch(/mot de passe|adresse e-mail/i);
      expect(fr.$('[data-lang="fr"]').getAttribute('aria-pressed'), file).toBe('true');

      const de = await open(file, { languages: ['de-DE'] });
      expect(de.document.documentElement.lang, file).toBe('en');
      expect(de.$('[data-lang="en"]').getAttribute('aria-pressed'), file).toBe('true');
    }
  });

  it('?lang= dans l’adresse passe avant la langue du navigateur', async () => {
    const page = await open('confirm.html', { query: '?token_hash=abc&lang=FR', languages: ['en-US'] });
    expect(page.document.documentElement.lang).toBe('fr');
  });

  it('les textes anglais écrits dans la page sont ceux de langue.js (aucun saut au chargement)', () => {
    const texts = TEXTS();
    for (const [page, file] of Object.entries(PAGES)) {
      const dom = new JSDOM(readFileSync(`${auth}${file}`, 'utf8'));
      for (const el of dom.window.document.querySelectorAll('[data-i18n]')) {
        const key = el.dataset.i18n;
        const en = texts[page].en[key] ?? texts.common.en[key];
        expect(el.textContent.trim(), `${file} : ${key}`).toBe(en);
      }
    }
  });

  it('le bouton EN | FR change les textes sans recharger ni renvoyer le jeton', async () => {
    const page = await open('confirm.html', { languages: ['en-US'] });
    expect(page.visible('state-success')).toBe(true);
    expect(page.$('#state-success').textContent).toContain('Your email has been confirmed');
    await page.click(page.$('[data-lang="fr"]'));
    expect(page.document.documentElement.lang).toBe('fr');
    expect(page.document.title).toContain('Confirmation de l’adresse e-mail');
    expect(page.$('#state-success').textContent).toContain('Votre adresse e-mail est confirmée');
    expect(page.$('[data-lang="fr"]').classList.contains('lang-switch__option--current')).toBe(true);
    expect(page.$('[data-lang="en"]').classList.contains('lang-switch__option--current')).toBe(false);
    expect(page.calls.length).toBe(1);
  });

  it('lien refusé : message du serveur en anglais, message français à sa place en français', async () => {
    const answer = { ok: false, body: { error_description: 'Token has expired or is invalid' } };
    const page = await open('email-change.html', { languages: ['en'], answer });
    expect(page.visible('state-error')).toBe(true);
    expect(page.$('#error-text').textContent).toBe('Token has expired or is invalid');
    await page.click(page.$('[data-lang="fr"]'));
    expect(page.$('#error-text').textContent).toBe('Ce lien n’est pas valide ou a expiré.');
    await page.click(page.$('[data-lang="en"]'));
    expect(page.$('#error-text').textContent).toBe('Token has expired or is invalid');
  });

  it('message du serveur inconnu : message générique de la page en français', async () => {
    const answer = { ok: false, body: { msg: 'Something unexpected' } };
    const page = await open('confirm.html', { languages: ['fr'], answer });
    expect(page.$('#error-text').textContent).toBe('Ce lien n’est pas valide ou a expiré.');
  });

  it('lien sans jeton : message traduit, aucun appel à Supabase', async () => {
    const page = await open('confirm.html', { query: '', languages: ['fr'] });
    expect(page.$('#error-text').textContent).toBe('Lien non valide : le jeton est absent.');
    expect(page.calls.length).toBe(0);
  });
});

describe('page « nouveau mot de passe »', () => {
  const form = async (languages) => {
    const page = await open('reset-password.html', { languages, answer: { ok: true, body: { access_token: 'jeton' } } });
    expect(page.visible('state-form')).toBe(true);
    return page;
  };
  const submit = async (page, password, confirm = password) => {
    page.$('#new-password').value = password;
    page.$('#confirm-password').value = confirm;
    page.$('#reset-form').dispatchEvent(new page.dom.window.Event('submit', { cancelable: true }));
    await flush();
    await flush();
  };

  it('10 caractères minimum, annoncés dans le champ et dans le message', async () => {
    const page = await form(['fr-FR']);
    expect(page.$('#new-password').minLength).toBe(10);
    expect(page.$('#new-password').placeholder).toBe('10 caractères minimum');
    await submit(page, '123456789');
    expect(page.$('#form-error').textContent).toBe('Le mot de passe doit contenir au moins 10 caractères.');
    expect(page.calls.length).toBe(1);
    await page.click(page.$('[data-lang="en"]'));
    expect(page.$('#form-error').textContent).toBe('Password must be at least 10 characters.');
    expect(page.$('#new-password').placeholder).toBe('Minimum 10 characters');
  });

  it('même mot de passe qu’avant : refus du serveur traduit en français', async () => {
    const page = await open('reset-password.html', {
      languages: ['fr'],
      answer: [
        { ok: true, body: { access_token: 'jeton' } },
        { ok: false, body: { msg: 'New password should be different from the old password.' } },
      ],
    });
    await submit(page, '1234567890');
    expect(page.$('#form-error').textContent).toBe('Le nouveau mot de passe doit être différent de l’ancien.');
    expect(page.$('#submit-btn').textContent).toBe('Changer le mot de passe');
  });

  it('mots de passe différents, puis mot de passe accepté', async () => {
    const page = await form(['fr']);
    await submit(page, '1234567890', '1234567891');
    expect(page.$('#form-error').textContent).toBe('Les deux mots de passe ne correspondent pas.');
    await submit(page, '1234567890');
    // Vérification du lien, nouveau mot de passe, puis fermeture de la session du lien
    expect(page.calls.length).toBe(3);
    expect(page.calls[1].init.method).toBe('PUT');
    expect(page.visible('state-success')).toBe(true);
    expect(page.$('#state-success').textContent).toContain('Votre mot de passe a été changé');
  });
});

// Le jeton du lien quitte l'adresse dès sa lecture, et la session ouverte
// par le lien est fermée quand elle ne sert plus, sur ce navigateur seulement.
describe('jeton du lien et session temporaire', () => {
  const LOGOUT = `${configScript.match(/url: '([^']+)'/)[1]}/auth/v1/logout?scope=local`;

  it.each(Object.values(PAGES))('%s : le jeton quitte l’adresse, ?lang= reste', async (file) => {
    const page = await open(file, { query: '?token_hash=abc&type=signup&lang=fr#access_token=x', languages: ['en'] });
    expect(page.dom.window.location.search).toBe('?lang=fr');
    expect(page.dom.window.location.hash).toBe('');
    expect(page.document.documentElement.lang).toBe('fr');
    expect(JSON.parse(page.calls[0].init.body).token_hash).toBe('abc');
  });

  it.each(['confirm.html', 'email-change.html'])('%s : la session du lien est fermée (scope=local)', async (file) => {
    const page = await open(file, { answer: { ok: true, body: { access_token: 'jeton-du-lien' } } });
    expect(page.visible('state-success')).toBe(true);
    expect(page.calls.length).toBe(2);
    expect(page.calls[1].url).toBe(LOGOUT);
    expect(page.calls[1].init.method).toBe('POST');
    expect(page.calls[1].init.headers.Authorization).toBe('Bearer jeton-du-lien');
  });

  it('confirmation sans session rendue : aucun appel de plus', async () => {
    const page = await open('confirm.html', { answer: { ok: true, body: {} } });
    expect(page.calls.length).toBe(1);
  });

  it('nouveau mot de passe enregistré : la session du lien est fermée ensuite', async () => {
    const page = await open('reset-password.html', {
      languages: ['fr'],
      answer: [{ ok: true, body: { access_token: 'jeton-du-lien' } }, { ok: true, body: {} }, { ok: true, body: {} }],
    });
    expect(page.calls.length).toBe(1);
    page.$('#new-password').value = '1234567890';
    page.$('#confirm-password').value = '1234567890';
    page.$('#reset-form').dispatchEvent(new page.dom.window.Event('submit', { cancelable: true }));
    await flush();
    await flush();
    await flush();
    expect(page.visible('state-success')).toBe(true);
    expect(page.calls.map((c) => c.init.method)).toEqual(['POST', 'PUT', 'POST']);
    expect(page.calls[2].url).toBe(LOGOUT);
    expect(page.calls[2].init.headers.Authorization).toBe('Bearer jeton-du-lien');
  });

  it('fermeture en échec réseau : la page reste sur son succès', async () => {
    const page = await open('confirm.html', { answer: [{ ok: true, body: { access_token: 't' } }] });
    // Deuxième appel : la liste est vide, la réponse simulée lève une erreur
    expect(page.visible('state-success')).toBe(true);
  });
});

