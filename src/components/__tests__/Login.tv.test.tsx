/**
 * Formulaire fournisseur à la télécommande : valider un champ avec OK ne doit jamais envoyer
 * le formulaire (avec les champs suivants vides), il amène la sélection sur le champ suivant.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';

vi.mock('react-i18next', () => ({
    useTranslation: () => ({ t: (key: string) => key, i18n: { resolvedLanguage: 'fr', changeLanguage: vi.fn() } }),
}));
vi.mock('../../contexts/SupabaseAuthContext', () => ({ useSupabaseAuth: () => ({ signOut: vi.fn() }) }));
vi.mock('../../contexts/DevOverrideContext', () => ({
    useDevOverrides: () => ({
        overrides: { xtreamPage: { forceLoading: false, forceProgress: null, forceError: null, forceMode: null } },
    }),
}));
vi.mock('../../utils/platform', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../../utils/platform')>()),
    isTv: () => true,
}));

import Login from '../Login';
import { installSpatialNavigation } from '../../utils/spatialNavigation';

const press = (target: Element, type: string, init: KeyboardEventInit = {}) => {
    const event = new KeyboardEvent(type, { key: 'Enter', bubbles: true, cancelable: true, ...init });
    target.dispatchEvent(event);
    return event;
};

/** Un OK complet, comme la télécommande : enfoncé, envoi implicite (keypress), relâché. */
const okOn = (field: Element) => {
    press(field, 'keydown');
    const keypress = press(field, 'keypress');
    press(field, 'keyup');
    return keypress;
};

describe('Login (TV) — OK dans les champs du fournisseur', () => {
    let uninstall: () => void;

    beforeEach(() => {
        uninstall = installSpatialNavigation();
    });

    afterEach(() => {
        uninstall();
        cleanup();
    });

    it("OK sur un champ dont le clavier est ouvert n'envoie pas le formulaire et passe au champ suivant", () => {
        const onLogin = vi.fn();
        render(<Login onLogin={onLogin} isLoading={false} progress={0} />);
        const host = screen.getByTestId('provider-url');
        const username = screen.getByTestId('provider-username');
        host.focus();

        okOn(host); // ouvre le clavier
        const validation = okOn(host); // valide le champ

        expect(validation.defaultPrevented).toBe(true);
        expect(document.activeElement).toBe(username);
        expect(onLogin).not.toHaveBeenCalled();
    });

    it('le mot de passe validé amène sur « Se connecter »', () => {
        render(<Login onLogin={vi.fn()} isLoading={false} progress={0} />);
        const password = screen.getByTestId('provider-password');
        password.focus();

        okOn(password);
        const validation = okOn(password);

        expect(validation.defaultPrevented).toBe(true);
        expect(document.activeElement).toBe(screen.getByTestId('provider-submit'));
    });
});
