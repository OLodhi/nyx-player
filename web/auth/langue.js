/**
 * Pages de compte (cibles des e-mails Supabase) en anglais et en français.
 *
 * Langue : `?lang=fr` ou `?lang=en` dans l'adresse, sinon la première langue du navigateur qui est
 * le français ou l'anglais, sinon l'anglais. Le bouton EN | FR change la langue sur place, sans
 * recharger : le jeton du lien est à usage unique, un rechargement le présenterait une seconde fois.
 *
 * Dans la page : `data-i18n="clé"` sur un élément (son texte), `data-i18n-placeholder="clé"` pour
 * un champ, `<body data-page="confirm|reset|email-change">`. Le script de la page affiche les textes
 * calculés avec `L.set(élément, clé, messageAnglaisDuServeur?)`.
 */
(function () {
    const TEXTS = {
        common: {
            en: {
                errMissing: 'Invalid link: missing token.',
                errExpired: 'This link is invalid or has expired.',
                errNetwork: 'Network error. Please check your connection and try again.',
                errGeneric: 'An error occurred.',
            },
            fr: {
                errMissing: 'Lien non valide : le jeton est absent.',
                errExpired: 'Ce lien n’est pas valide ou a expiré.',
                errNetwork: 'Erreur réseau. Vérifiez votre connexion, puis réessayez.',
                errGeneric: 'Une erreur s’est produite.',
            },
        },
        confirm: {
            en: {
                title: 'Email Confirmation — Nyx Player',
                subtitle: 'Email Confirmation',
                verifying: 'Verifying…',
                success1: '✓ Your email has been confirmed!',
                success2: 'You can go back to the app.',
            },
            fr: {
                title: 'Confirmation de l’adresse e-mail — Nyx Player',
                subtitle: 'Confirmation de l’adresse e-mail',
                verifying: 'Vérification…',
                success1: '✓ Votre adresse e-mail est confirmée !',
                success2: 'Vous pouvez revenir dans l’application.',
            },
        },
        reset: {
            en: {
                title: 'Reset Password — Nyx Player',
                subtitle: 'Password Reset',
                verifying: 'Verifying link…',
                newPassword: 'New password',
                minChars: 'Minimum {min} characters',
                confirmPassword: 'Confirm password',
                reenter: 'Re-enter password',
                submit: 'Update password',
                updating: 'Updating…',
                success1: '✓ Password updated successfully!',
                success2: 'You can now go back to the app and sign in.',
                errTooShort: 'Password must be at least {min} characters.',
                errMismatch: 'Passwords do not match.',
                errUpdate: 'Failed to update password.',
            },
            fr: {
                title: 'Nouveau mot de passe — Nyx Player',
                subtitle: 'Nouveau mot de passe',
                verifying: 'Vérification du lien…',
                newPassword: 'Nouveau mot de passe',
                minChars: '{min} caractères minimum',
                confirmPassword: 'Confirmez le mot de passe',
                reenter: 'Saisissez-le une seconde fois',
                submit: 'Changer le mot de passe',
                updating: 'Modification…',
                success1: '✓ Votre mot de passe a été changé !',
                success2: 'Vous pouvez revenir dans l’application et vous connecter.',
                errTooShort: 'Le mot de passe doit contenir au moins {min} caractères.',
                errMismatch: 'Les deux mots de passe ne correspondent pas.',
                errUpdate: 'Le mot de passe n’a pas pu être changé.',
            },
        },
        'email-change': {
            en: {
                title: 'Email Address Change — Nyx Player',
                subtitle: 'Email Address Change',
                verifying: 'Verifying…',
                success1: '✓ Your email address has been updated!',
                success2: 'You can go back to the app.',
            },
            fr: {
                title: 'Changement d’adresse e-mail — Nyx Player',
                subtitle: 'Changement d’adresse e-mail',
                verifying: 'Vérification…',
                success1: '✓ Votre adresse e-mail a été changée !',
                success2: 'Vous pouvez revenir dans l’application.',
            },
        },
    };

    const LANGS = ['en', 'fr'];

    // Messages connus du serveur (en anglais) et leur traduction ; les autres prennent en français
    // le message générique de leur clé.
    const SERVER_FR = [
        [/different from the old password/i, 'Le nouveau mot de passe doit être différent de l’ancien.'],
        [/expired|invalid/i, 'Ce lien n’est pas valide ou a expiré.'],
    ];

    function pickLang(search, languages) {
        const asked = (new URLSearchParams(search).get('lang') || '').toLowerCase();
        if (LANGS.includes(asked)) return asked;
        for (const tag of languages || []) {
            const base = String(tag).toLowerCase().split('-')[0];
            if (LANGS.includes(base)) return base;
        }
        return 'en';
    }

    function init(doc, win) {
        const page = doc.body.dataset.page;
        const vars = {};
        const nav = win.navigator;
        let lang = pickLang(win.location.search, nav.languages?.length ? nav.languages : [nav.language]);

        const t = (key) => {
            const text = TEXTS[page]?.[lang]?.[key] ?? TEXTS.common[lang][key] ?? key;
            return text.replace(/\{(\w+)\}/g, (_, name) => String(vars[name] ?? ''));
        };

        // Message du serveur (en anglais) : gardé tel quel en anglais ; en français, sa traduction
        // s'il est connu, sinon le message générique de la clé.
        function textOf(key, raw) {
            if (!raw) return t(key);
            if (lang === 'en') return raw;
            return SERVER_FR.find(([pattern]) => pattern.test(raw))?.[1] ?? t(key);
        }

        function render() {
            doc.documentElement.lang = lang;
            doc.title = t('title');
            doc.querySelectorAll('[data-i18n]').forEach((el) => {
                el.textContent = textOf(el.dataset.i18n, el.dataset.raw);
            });
            doc.querySelectorAll('[data-i18n-placeholder]').forEach((el) => {
                el.placeholder = t(el.dataset.i18nPlaceholder);
            });
            doc.querySelectorAll('.lang-switch [data-lang]').forEach((btn) => {
                const current = btn.dataset.lang === lang;
                btn.classList.toggle('lang-switch__option--current', current);
                btn.setAttribute('aria-pressed', String(current));
            });
        }

        doc.querySelectorAll('.lang-switch [data-lang]').forEach((btn) => {
            btn.addEventListener('click', () => {
                lang = btn.dataset.lang;
                render();
            });
        });

        render();

        return {
            get lang() {
                return lang;
            },
            t,
            /** Valeurs des {variables} des textes, par exemple { min: 6 }. */
            vars(values) {
                Object.assign(vars, values);
                render();
            },
            /** Affiche le texte de `key` dans `el`, et le garde à jour au changement de langue. */
            set(el, key, rawEnglish) {
                el.dataset.i18n = key;
                if (rawEnglish) el.dataset.raw = rawEnglish;
                else delete el.dataset.raw;
                el.textContent = textOf(key, rawEnglish);
            },
        };
    }

    window.NyxAuthLang = { TEXTS, pickLang, init };
})();
