/**
 * Déconnexion hors ligne : la méthode interne de Supabase qui efface la session de
 * l'appareil existe toujours dans la version installée. Ce test casse à une mise à jour de
 * @supabase/supabase-js qui la retirerait, avant que la déconnexion hors ligne ne casse en silence.
 */

import { describe, it, expect, vi } from 'vitest';
import { createClient } from '@supabase/supabase-js';

vi.mock('../supabaseClient', async () => {
    const { createClient: create } = await import('@supabase/supabase-js');
    return { supabase: create('https://example.invalid', 'cle-de-test', { auth: { persistSession: false, autoRefreshToken: false } }) };
});

import { supabase } from '../supabaseClient';
import { forgetSessionOnDevice } from '../authLocalSignOut';

describe('forgetSessionOnDevice', () => {
    it('la version installée de Supabase a toujours la méthode utilisée', () => {
        const client = createClient('https://example.invalid', 'cle-de-test', { auth: { persistSession: false, autoRefreshToken: false } });
        expect(typeof (client.auth as unknown as { _removeSession?: unknown })._removeSession).toBe('function');
    });

    it('efface la session et annonce SIGNED_OUT, sans réseau', async () => {
        const events: string[] = [];
        const { data } = supabase.auth.onAuthStateChange((event) => { events.push(event); });
        await supabase.auth.getSession(); // initialisation du client terminée
        events.length = 0;

        await forgetSessionOnDevice();

        expect(events).toContain('SIGNED_OUT');
        data.subscription.unsubscribe();
    });
});
