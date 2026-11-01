/**
 * Le texte sous « Supprimer aussi mes données cloud » dit exactement ce que la purge
 * efface. Si la liste des tables change, ce test oblige à revoir le texte, en français et en anglais.
 */

import { describe, it, expect, vi } from 'vitest';

vi.mock('../../supabaseClient', () => ({ supabase: {} }));

import { CLOUD_PURGE_TABLES } from '../syncPurge';
import fr from '../../../i18n/locales/fr/settings.json';
import en from '../../../i18n/locales/en/settings.json';

/** Ce que chaque table effacée devient dans le texte montré à l'utilisateur */
const WORDING: Record<(typeof CLOUD_PURGE_TABLES)[number], { fr: string; en: string }> = {
  user_watchlist: { fr: 'Ma Liste', en: 'My List' },
  user_playback_progress: { fr: 'positions de lecture', en: 'playback positions' },
  user_livetv_bookmarks: { fr: 'favoris TV', en: 'TV favorites' },
  user_hidden_categories: { fr: 'catégories masquées', en: 'hidden categories' },
  user_preferences: { fr: 'préférences', en: 'preferences' },
};

describe('texte de la purge cloud', () => {
  it('chaque table effacée a sa formulation', () => {
    expect(Object.keys(WORDING).sort()).toEqual([...CLOUD_PURGE_TABLES].sort());
  });

  it.each([
    ['fr', fr.purge_cloud_data_hint, 'Votre compte Nyx et votre profil sont conservés'],
    ['en', en.purge_cloud_data_hint, 'Your Nyx account and profile are kept'],
  ] as const)('%s : nomme tout ce qui est effacé et dit que le compte et le profil restent', (lang, text, kept) => {
    for (const table of CLOUD_PURGE_TABLES) expect(text).toContain(WORDING[table][lang]);
    expect(text).toContain(kept);
  });

  it('la purge garde bien le compte et le profil', () => {
    expect(CLOUD_PURGE_TABLES).not.toContain('user_profiles');
  });
});
