/**
 * Affiche d'une reprise envoyée au cloud : seules les images TMDB partent.
 */
import { describe, it, expect } from 'vitest';
import { cloudPosterUrl } from '../cloudPoster';

describe('cloudPosterUrl', () => {
  it('garde une affiche TMDB', () => {
    const url = 'https://image.tmdb.org/t/p/w500/abc.jpg';
    expect(cloudPosterUrl(url)).toBe(url);
  });

  it("n'envoie pas l'affiche du fournisseur (nom du serveur, parfois identifiants)", () => {
    expect(cloudPosterUrl('http://provider.example:8080/images/xyz.jpg')).toBeNull();
    expect(cloudPosterUrl('http://provider.example/get.php?username=u&password=p&poster=1')).toBeNull();
  });

  it('passe en https une affiche TMDB donnée en http par le fournisseur', () => {
    expect(cloudPosterUrl('http://image.tmdb.org/t/p/w500/abc.jpg')).toBe('https://image.tmdb.org/t/p/w500/abc.jpg');
  });

  it("refuse ce qui imite seulement l'adresse TMDB", () => {
    expect(cloudPosterUrl('http://image.tmdb.org.provider.example/abc.jpg')).toBeNull();
    expect(cloudPosterUrl('https://image.tmdb.org.provider.example/abc.jpg')).toBeNull();
    expect(cloudPosterUrl('https://provider.example/?u=https://image.tmdb.org/abc.jpg')).toBeNull();
  });

  it('rien → rien', () => {
    expect(cloudPosterUrl(null)).toBeNull();
    expect(cloudPosterUrl(undefined)).toBeNull();
    expect(cloudPosterUrl('')).toBeNull();
  });
});
