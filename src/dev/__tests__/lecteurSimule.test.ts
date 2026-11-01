/**
 * Lecteur simulé des versions du banc (dev/lecteurSimule.ts) : durée fixe, départ à la position de
 * reprise (option `start`), avance hors pause, sauts, arrêt. Aucune vidéo, aucune requête : le module
 * ne connaît même pas l'adresse chargée. Sa fidélité à mpv, étape par étape, est vérifiée contre une
 * trace du vrai mpv dans lecteurSimuleContrat.test.ts ; ici, le reste du contrat.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const plateforme = vi.hoisted(() => ({ android: false }));
vi.mock('../../utils/platform', () => ({ isAndroid: () => plateforme.android }));

async function charger() {
  vi.resetModules();
  vi.spyOn(console, 'info').mockImplementation(() => {});
  const L = await import('../lecteurSimule');
  /** Ouverture complète du fichier (chargement puis fin du saut initial), avec une marge */
  OUVERTURE_MS = L.DELAI_CHARGEMENT_MS + L.DELAI_SAUT_MS + 50;
  return L;
}

let OUVERTURE_MS = 0;

describe('lecteurSimule', () => {
  beforeEach(() => { vi.useFakeTimers(); plateforme.android = false; });
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

  it('chargement : rien pendant la commande, puis durée fixe, position 0, quatre positions par seconde', async () => {
    const L = await charger();
    const vus: Array<[string, unknown]> = [];
    await L.observer(['time-pos', 'duration', 'pause'], ({ name, data }) => vus.push([name, data]));
    await L.commande('loadfile', ['http://127.0.0.1:8765/movie/banc/banc/100.mp4', 'replace']);
    expect(vus).toEqual([]);
    await expect(L.lire('duration')).rejects.toThrow(/unavailable/);
    await vi.advanceTimersByTimeAsync(OUVERTURE_MS);
    expect(await L.lire('duration')).toBe(L.DUREE_SIMULEE_S);
    expect(vus).toEqual([['duration', L.DUREE_SIMULEE_S], ['time-pos', 0]]);
    await vi.advanceTimersByTimeAsync(1000);
    const positions = vus.filter(([n]) => n === 'time-pos').map(([, d]) => d as number);
    expect(positions.length).toBeGreaterThanOrEqual(4);
    expect(positions.some((p) => !Number.isInteger(p))).toBe(true);
    await L.ecrire('pause', true);
    const arretee = await L.lire('time-pos');
    await vi.advanceTimersByTimeAsync(5000);
    expect(await L.lire('time-pos')).toBe(arretee);
  });

  it('Windows et Linux : un abonnement pris après le chargement ne reçoit pas la durée déjà envoyée', async () => {
    const L = await charger();
    await L.commande('loadfile', ['x']);
    await vi.advanceTimersByTimeAsync(OUVERTURE_MS);
    const vus: string[] = [];
    await L.observer(['duration', 'volume', 'pause'], ({ name }) => vus.push(name));
    await vi.advanceTimersByTimeAsync(1000);
    expect(vus).toEqual([]);
    // L'app doit la relire : elle reste lisible
    expect(await L.lire('duration')).toBe(L.DUREE_SIMULEE_S);
  });

  it('Android : valeurs courantes relues juste après l\'abonnement, en différé, « auto » devenu false', async () => {
    plateforme.android = true;
    const L = await charger();
    const vus: Array<[string, unknown]> = [];
    await L.observer(['volume', 'sid', 'duration'], ({ name, data }) => vus.push([name, data]));
    expect(vus).toEqual([]);
    await vi.advanceTimersByTimeAsync(0);
    expect(vus).toEqual([['volume', 100], ['sid', false]]);
    expect(await L.lire('duration')).toBeNull();
  });

  it('Android : la liste des pistes n\'est qu\'un signal, relue par l\'app ; chaque lecture repart hors pause', async () => {
    plateforme.android = true;
    const L = await charger();
    const vus: Array<[string, unknown]> = [];
    await L.ecrire('pause', true);
    await L.observer(['track-list', 'pause'], ({ name, data }) => vus.push([name, data]));
    await vi.advanceTimersByTimeAsync(0);
    vus.length = 0;
    await L.commande('loadfile', ['x']);
    await vi.advanceTimersByTimeAsync(OUVERTURE_MS);
    expect(vus).toContainEqual(['pause', false]);
    expect(vus.filter(([n]) => n === 'track-list').every(([, d]) => d === null)).toBe(true);
    expect(((await L.lire('track-list')) as unknown[]).length).toBe(4);
  });

  it('annonce ses pistes comme mpv (première piste audio prise, sans sous-titres), plus rien à l\'arrêt', async () => {
    const L = await charger();
    await L.commande('loadfile', ['x']);
    await vi.advanceTimersByTimeAsync(OUVERTURE_MS);
    const pistes = (await L.lire('track-list')) as Array<{ id: number; type: string; lang?: string; selected: boolean }>;
    expect(pistes.filter((p) => p.type === 'audio').map((p) => p.lang)).toEqual(['fre', 'eng']);
    expect(pistes.filter((p) => p.type === 'sub').map((p) => p.lang)).toEqual(['fre']);
    expect(pistes.filter((p) => p.selected).map((p) => `${p.type}${p.id}`)).toEqual(['video1', 'audio1']);
    expect(await L.lire('aid')).toBe(1);
    expect(await L.lire('sid')).toBe(false);
    await L.commande('stop');
    expect(await L.lire('track-list')).toEqual([]);
    expect(await L.lire('aid')).toBe('auto');
  });

  it('une piste choisie reste choisie au fichier suivant, comme avec mpv', async () => {
    const L = await charger();
    await L.commande('loadfile', ['x']);
    await vi.advanceTimersByTimeAsync(OUVERTURE_MS);
    const listes: unknown[] = [];
    await L.observer(['track-list'], ({ data }) => listes.push(data));
    await L.ecrire('aid', 2);
    await L.ecrire('sid', 1);
    await vi.advanceTimersByTimeAsync(0);
    expect(listes).toHaveLength(2);
    await L.commande('loadfile', ['y']);
    await vi.advanceTimersByTimeAsync(OUVERTURE_MS);
    expect(await L.lire('aid')).toBe(2);
    expect(await L.lire('sid')).toBe(1);
    await L.ecrire('sid', 0);
    expect(await L.lire('sid')).toBe(false);
  });

  it('reprise : part de l\'option « start », gardée jusqu\'à « none »', async () => {
    const L = await charger();
    await L.ecrire('start', '180');
    await L.commande('loadfile', ['x']);
    await vi.advanceTimersByTimeAsync(OUVERTURE_MS);
    expect(await L.lire('time-pos')).toBeGreaterThanOrEqual(180);
    await L.commande('loadfile', ['x']);
    await vi.advanceTimersByTimeAsync(OUVERTURE_MS);
    expect(await L.lire('time-pos')).toBeGreaterThanOrEqual(180);
    await L.ecrire('start', 'none');
    await L.commande('loadfile', ['x']);
    await vi.advanceTimersByTimeAsync(OUVERTURE_MS);
    expect(await L.lire('time-pos')).toBeLessThan(1);
  });

  it('sauts absolus, relatifs et en pourcentage, bornés, avec « saut en cours » ; la fin met en pause', async () => {
    const L = await charger();
    await L.commande('loadfile', ['x']);
    await vi.advanceTimersByTimeAsync(OUVERTURE_MS);
    await L.ecrire('pause', true);
    const sauts: unknown[] = [];
    await L.observer(['seeking'], ({ data }) => sauts.push(data));
    await L.commande('seek', ['240', 'absolute']);
    expect(await L.lire('time-pos')).toBe(240);
    await vi.advanceTimersByTimeAsync(50);
    expect(sauts).toEqual([true, false]);
    await L.commande('seek', ['-10', 'relative']);
    expect(await L.lire('time-pos')).toBe(230);
    await L.commande('seek', ['50', 'absolute-percent']);
    expect(await L.lire('time-pos')).toBe(L.DUREE_SIMULEE_S / 2);
    await L.commande('seek', ['99999', 'absolute']);
    expect(await L.lire('time-pos')).toBe(L.DUREE_SIMULEE_S);
    expect(await L.lire('eof-reached')).toBe(true);
    expect(await L.lire('pause')).toBe(true);
    await expect(L.commande('seek', ['abc', 'absolute'])).rejects.toThrow(/invalide/);
  });

  it('arrêt : position et durée indisponibles, « end-file » (stop) puis « idle », plus d\'horloge', async () => {
    const L = await charger();
    const evenements: string[] = [];
    await L.ecouterEvenements((e) => evenements.push(`${e.event}:${String(e.reason ?? '')}`));
    await L.commande('loadfile', ['x']);
    await vi.advanceTimersByTimeAsync(OUVERTURE_MS);
    await L.commande('stop');
    await expect(L.lire('time-pos')).rejects.toThrow(/unavailable/);
    await expect(L.lire('duration')).rejects.toThrow(/unavailable/);
    await vi.advanceTimersByTimeAsync(5000);
    await expect(L.lire('time-pos')).rejects.toThrow(/unavailable/);
    expect(evenements).toEqual(['start-file:', 'file-loaded:', 'playback-restart:', 'end-file:stop', 'idle:']);
  });

  it('un arrêt pendant l\'ouverture l\'abandonne : le fichier ne finit jamais de charger', async () => {
    const L = await charger();
    const vus: string[] = [];
    await L.observer(['duration', 'time-pos'], ({ name }) => vus.push(name));
    await L.commande('loadfile', ['x']);
    await L.commande('stop');
    await vi.advanceTimersByTimeAsync(2000);
    expect(vus).toEqual([]);
  });

  it('Android : ni durée ni position indisponibles transmises entre deux fichiers, jamais le nom du fichier', async () => {
    plateforme.android = true;
    const L = await charger();
    const vus: Array<[string, unknown]> = [];
    await L.observer(['duration', 'time-pos', 'seeking', 'filename', 'eof-reached', 'track-list'], ({ name, data }) => vus.push([name, data]));
    await L.commande('loadfile', ['x']);
    await vi.advanceTimersByTimeAsync(OUVERTURE_MS);
    vus.length = 0;
    await L.commande('loadfile', ['y']);
    await L.commande('stop');
    await vi.advanceTimersByTimeAsync(OUVERTURE_MS);
    const indisponibles = vus.filter(([, d]) => d === null).map(([n]) => n);
    expect(indisponibles.every((n) => n === 'track-list' || n === 'eof-reached')).toBe(true);
    expect(indisponibles).toContain('eof-reached');
    expect(vus.some(([n]) => n === 'filename')).toBe(false);
  });

  it('deux sauts rapprochés : « saut en cours » reste vrai jusqu\'à la fin du dernier', async () => {
    const L = await charger();
    await L.commande('loadfile', ['x']);
    await vi.advanceTimersByTimeAsync(OUVERTURE_MS);
    const sauts: unknown[] = [];
    await L.observer(['seeking'], ({ data }) => sauts.push(data));
    await L.commande('seek', ['10', 'relative']);
    await vi.advanceTimersByTimeAsync(L.DELAI_SAUT_MS / 2);
    await L.commande('seek', ['10', 'relative']);
    await vi.advanceTimersByTimeAsync(L.DELAI_SAUT_MS / 2 + 1);
    expect(sauts).toEqual([true]);
    await vi.advanceTimersByTimeAsync(L.DELAI_SAUT_MS);
    expect(sauts).toEqual([true, false]);
  });

  it('saut sans fichier refusé, comme mpv', async () => {
    const L = await charger();
    await expect(L.commande('seek', ['3', 'relative'])).rejects.toThrow();
  });

  it('un fichier chargé pendant l\'ouverture du précédent : la fin de l\'ancienne ouverture ne touche pas le nouveau', async () => {
    const L = await charger();
    const vus: Array<[string, unknown]> = [];
    await L.observer(['seeking', 'duration'], ({ name, data }) => vus.push([name, data]));
    await L.commande('loadfile', ['x']);
    await vi.advanceTimersByTimeAsync(L.DELAI_CHARGEMENT_MS + 1);
    await L.commande('loadfile', ['y']);
    await vi.advanceTimersByTimeAsync(OUVERTURE_MS);
    expect(vus.filter(([n, d]) => n === 'seeking' && d === false)).toHaveLength(1);
    expect(await L.lire('seeking')).toBe(false);
    expect(await L.lire('duration')).toBe(L.DUREE_SIMULEE_S);
  });

  it('un abonné n\'est prévenu que des changements, et plus de rien une fois désabonné', async () => {
    const L = await charger();
    const vus: Array<[string, unknown]> = [];
    const fin = await L.observer(['volume'], ({ name, data }) => vus.push([name, data]));
    await L.ecrire('volume', 100);
    await L.ecrire('volume', 50);
    await vi.advanceTimersByTimeAsync(0);
    expect(vus).toEqual([['volume', 50]]);
    fin();
    await L.ecrire('volume', 30);
    await vi.advanceTimersByTimeAsync(0);
    expect(vus).toEqual([['volume', 50]]);
  });
});
