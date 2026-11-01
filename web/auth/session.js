/**
 * Jeton du lien et session temporaire des pages de compte (cibles des e-mails Supabase).
 * - Le jeton est lu une seule fois, puis retiré de l'adresse (historique, en-tête Referer,
 *   copie de l'adresse). Seul `?lang=` reste. La mesure d'audience n'est plus chargée sur ces pages.
 * - La session que Supabase ouvre en vérifiant le lien est fermée dès qu'elle ne sert plus,
 *   avec `scope=local` : cette session seulement, jamais celles des appareils de l'utilisateur.
 *
 * Dans la page, après `NyxAuthLang.init` (qui lit `?lang=`) :
 *   const linkParams = NyxAuthSession.takeLinkParams(window);
 *   …
 *   await NyxAuthSession.endLinkSession(window, SUPABASE_URL, SUPABASE_ANON_KEY, accessToken);
 */
(function () {
    /** Paramètres du lien, lus avant d'être retirés de l'adresse. */
    function takeLinkParams(win) {
        const params = new URLSearchParams(win.location.search);
        const kept = new URLSearchParams();
        const lang = params.get('lang');
        if (lang) kept.set('lang', lang);
        const query = kept.toString();
        try {
            win.history.replaceState(null, '', win.location.pathname + (query ? `?${query}` : ''));
        } catch (err) {
            // Navigateur qui refuse : la page marche quand même, le jeton est à usage unique
        }
        return params;
    }

    /** Ferme la session ouverte par le lien. Sans effet visible, même en cas d'échec. */
    async function endLinkSession(win, url, key, accessToken) {
        if (!accessToken) return;
        try {
            await win.fetch(`${url}/auth/v1/logout?scope=local`, {
                method: 'POST',
                headers: { apikey: key, Authorization: `Bearer ${accessToken}` },
            });
        } catch (err) {
            // Session laissée au serveur, qui la purge après 90 jours
        }
    }

    window.NyxAuthSession = { takeLinkParams, endLinkSession };
})();
