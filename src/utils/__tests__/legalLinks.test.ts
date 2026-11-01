import { describe, it, expect } from 'vitest';
import { legalNoticesUrl, privacyPolicyUrl, termsUrl } from '../legalLinks';

describe('termsUrl', () => {
    it('ouvre les conditions en français quand l’interface est en français', () => {
        expect(termsUrl('fr')).toBe('https://nyxplayer.app/conditions.html');
        expect(termsUrl('fr-FR')).toBe('https://nyxplayer.app/conditions.html');
    });

    it('ouvre la version anglaise dans les autres langues ou sans langue connue', () => {
        expect(termsUrl('en')).toBe('https://nyxplayer.app/terms.html');
        expect(termsUrl(undefined)).toBe('https://nyxplayer.app/terms.html');
    });
});

describe('privacyPolicyUrl', () => {
    it('ouvre la version française quand l’interface est en français', () => {
        expect(privacyPolicyUrl('fr')).toBe('https://nyxplayer.app/confidentialite.html');
        expect(privacyPolicyUrl('FR')).toBe('https://nyxplayer.app/confidentialite.html');
        expect(privacyPolicyUrl('fr-FR')).toBe('https://nyxplayer.app/confidentialite.html');
    });

    it('ouvre la version anglaise dans les autres langues ou sans langue connue', () => {
        expect(privacyPolicyUrl('en')).toBe('https://nyxplayer.app/privacy.html');
        expect(privacyPolicyUrl('en-US')).toBe('https://nyxplayer.app/privacy.html');
        expect(privacyPolicyUrl(undefined)).toBe('https://nyxplayer.app/privacy.html');
    });
});

describe('legalNoticesUrl', () => {
    it('ouvre les mentions légales en français quand l’interface est en français', () => {
        expect(legalNoticesUrl('fr')).toBe('https://nyxplayer.app/mentions-legales.html');
        expect(legalNoticesUrl('fr-CA')).toBe('https://nyxplayer.app/mentions-legales.html');
    });

    it('ouvre la version anglaise dans les autres langues ou sans langue connue', () => {
        expect(legalNoticesUrl('en')).toBe('https://nyxplayer.app/legal.html');
        expect(legalNoticesUrl(undefined)).toBe('https://nyxplayer.app/legal.html');
    });
});
