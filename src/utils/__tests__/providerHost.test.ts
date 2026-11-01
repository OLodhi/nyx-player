import { describe, it, expect, afterEach } from 'vitest';
import { normalizeProviderHost, providerHostSpellings, sameProviderHost, noteTypedProviderHost, typedProviderHostSpellings } from '../providerHost';

describe('normalizeProviderHost', () => {
  it.each([
    ['http://x.com:8080', 'http://x.com:8080'],
    ['http://x.com:8080/', 'http://x.com:8080'],
    ['  http://x.com:8080  ', 'http://x.com:8080'],
    ['Http://X.COM:8080//', 'http://x.com:8080'],
    ['x.com:8080', 'http://x.com:8080'],
    ['http://x.com:80', 'http://x.com'],
    ['https://x.com:443/', 'https://x.com'],
    ['http://x.com/iptv/', 'http://x.com/iptv'],
  ])('%s → %s', (input, expected) => {
    expect(normalizeProviderHost(input)).toBe(expected);
  });

  it('une adresse déjà propre ne change pas : son empreinte reste la même', () => {
    for (const host of ['http://x.com:8080', 'https://line.example.net', 'http://1.2.3.4:25461']) {
      expect(normalizeProviderHost(host)).toBe(host);
    }
  });

  it('une adresse illisible perd seulement ses espaces et ses « / » finaux', () => {
    expect(normalizeProviderHost(' ftp://x.com/ ')).toBe('ftp://x.com');
  });
});

describe('sameProviderHost', () => {
  it('même serveur écrit autrement', () => {
    expect(sameProviderHost('http://x.com:8080', 'http://x.com:8080/')).toBe(true);
    expect(sameProviderHost('http://x.com:8080', 'HTTP://X.com:8080 ')).toBe(true);
    expect(sameProviderHost('http://x.com', 'https://x.com')).toBe(true);
    expect(sameProviderHost('http://x.com', 'http://x.com:80')).toBe(true);
  });

  it('autre hôte, autre port ou autre chemin : autre fournisseur', () => {
    expect(sameProviderHost('http://x.com:8080', 'http://y.com:8080')).toBe(false);
    expect(sameProviderHost('http://x.com:8080', 'http://x.com:8000')).toBe(false);
    expect(sameProviderHost('http://x.com/a', 'http://x.com/b')).toBe(false);
    // Port 443 écrit avec http : un autre port que celui de http://x.com
    expect(sameProviderHost('http://x.com:443', 'http://x.com')).toBe(false);
  });
});

describe('providerHostSpellings', () => {
  it('commence par l\'adresse nettoyée et couvre les écritures d\'avant le nettoyage', () => {
    const spellings = providerHostSpellings('http://x.com:8080');
    expect(spellings[0]).toBe('http://x.com:8080');
    for (const old of ['http://x.com:8080/', 'Http://x.com:8080', 'https://x.com:8080/', 'HTTP://x.com:8080']) {
      expect(spellings).toContain(old);
    }
  });

  it('garde l\'hôte tel que saisi et l\'adresse brute', () => {
    const spellings = providerHostSpellings(' http://X.com/ ');
    expect(spellings).toContain('http://X.com');
    expect(spellings).toContain(' http://X.com/ ');
    expect(spellings).toContain('http://x.com:80');
  });

  it('hôte écrit avec une majuscule ou en majuscules avant le nettoyage : retrouvé par son empreinte', () => {
    const spellings = providerHostSpellings('http://fournisseur.com:8080');
    expect(spellings).toContain('http://Fournisseur.com:8080');
    expect(spellings).toContain('http://FOURNISSEUR.COM:8080/');
  });

  it('ne propose jamais un autre hôte ni un autre port', () => {
    for (const host of ['http://x.com:8080/', 'http://x.com:443', 'https://x.com:80']) {
      for (const spelling of providerHostSpellings(host)) {
        expect(sameProviderHost(spelling, host)).toBe(true);
      }
    }
  });
});

describe('typedProviderHostSpellings', () => {
  afterEach(() => noteTypedProviderHost(''));

  it('saisie brute du même serveur : gardée telle quelle et sans espaces', () => {
    noteTypedProviderHost(' http://MonFournisseur.example//');
    expect(typedProviderHostSpellings('http://monfournisseur.example')).toEqual([' http://MonFournisseur.example//', 'http://MonFournisseur.example//']);
  });

  it('saisie d\'un autre serveur : rien', () => {
    noteTypedProviderHost('http://autre.example');
    expect(typedProviderHostSpellings('http://monfournisseur.example')).toEqual([]);
  });
});
