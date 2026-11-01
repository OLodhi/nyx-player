import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  CLOUD_CONTAINER_EXTENSION_MAX_BYTES,
  CLOUD_POSTER_URL_MAX_BYTES,
  CLOUD_TITLE_MAX_LENGTH,
  PROFILE_NAME_MAX_LENGTH,
  CLOUD_PROVIDER_ID_MAX_BYTES,
  cloudContainerExtension,
  cloudNextEpisodeId,
  fitsCloudProviderId,
  cloudTitle,
} from '../cloudLimits';
import { cloudPosterUrl } from '../cloudPoster';

const bytes = (value: string) => new TextEncoder().encode(value).length;

// La base refuse une valeur trop longue : un seul refus bloquerait tout l'envoi groupé
// des reprises. L'app reste sous les bornes du script SQL.
describe('valeurs envoyées au cloud : sous les bornes de la base', () => {
  it('garde un titre normal, coupe un titre démesuré', () => {
    expect(cloudTitle('Le Parrain')).toBe('Le Parrain');
    expect(cloudTitle('x'.repeat(5000))).toHaveLength(CLOUD_TITLE_MAX_LENGTH);
  });

  it('coupe par caractère entier : jamais un demi-emoji, jamais plus de 2 000 octets', () => {
    const title = cloudTitle('a' + '😀'.repeat(600));
    expect(Array.from(title)).toHaveLength(CLOUD_TITLE_MAX_LENGTH);
    expect(title.endsWith('😀')).toBe(true);
    expect(bytes(title)).toBeLessThanOrEqual(2000);
  });

  it('une affiche TMDB démesurée ne part pas', () => {
    const base = 'https://image.tmdb.org/t/p/w500/';
    expect(cloudPosterUrl(`${base}a.jpg`)).toBe(`${base}a.jpg`);
    expect(cloudPosterUrl(base + 'x'.repeat(CLOUD_POSTER_URL_MAX_BYTES))).toBeNull();
  });

  it('garde une extension normale, laisse tomber une valeur fantaisiste', () => {
    expect(cloudContainerExtension('mkv')).toBe('mkv');
    expect(cloudContainerExtension(undefined)).toBeNull();
    expect(cloudContainerExtension('x'.repeat(CLOUD_CONTAINER_EXTENSION_MAX_BYTES + 1))).toBeNull();
    expect(cloudContainerExtension('é'.repeat(9))).toBeNull();
  });

  // Script SQL appliqué à la base de production : absent d'une copie publique du dépôt
  const scriptSql = resolve(__dirname, '../../../../supabase/seance/09_bornes_fb01.sql');
  it.skipIf(!existsSync(scriptSql))('mêmes bornes que le script SQL (ou plus petites)', () => {
    const sql = readFileSync(scriptSql, 'utf8');
    const bound = (column: string) => Number(new RegExp(`octet_length\\(${column}\\) <= (\\d+)`).exec(sql)?.[1]);
    // Un caractère pèse au plus 4 octets en UTF-8
    expect(bound('title')).toBe(CLOUD_TITLE_MAX_LENGTH * 4);
    expect(bound('container_extension')).toBe(CLOUD_CONTAINER_EXTENSION_MAX_BYTES);
    expect(bound('poster_url')).toBe(CLOUD_POSTER_URL_MAX_BYTES);
    expect(bound('display_name')).toBeGreaterThanOrEqual(PROFILE_NAME_MAX_LENGTH * 4);
    for (const column of ['next_episode_id', 'item_id', 'category_id']) {
      expect(bound(column), column).toBe(CLOUD_PROVIDER_ID_MAX_BYTES);
    }
  });

  // Les numéros du fournisseur n'avaient pas de garde dans l'app ; un seul
  // numéro de plus de 128 octets bloquait en silence tout l'envoi de son domaine.
  it('un numéro du fournisseur démesuré ne part pas (128 octets au plus)', () => {
    expect(fitsCloudProviderId('1234567')).toBe(true);
    expect(fitsCloudProviderId('x'.repeat(CLOUD_PROVIDER_ID_MAX_BYTES))).toBe(true);
    expect(fitsCloudProviderId('x'.repeat(CLOUD_PROVIDER_ID_MAX_BYTES + 1))).toBe(false);
    expect(fitsCloudProviderId('é'.repeat(65))).toBe(false);
    expect(cloudNextEpisodeId('42')).toBe('42');
    expect(cloudNextEpisodeId(undefined)).toBeNull();
    expect(cloudNextEpisodeId('9'.repeat(200))).toBeNull();
  });
});
