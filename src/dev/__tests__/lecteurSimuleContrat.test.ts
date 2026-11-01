/**
 * Contrat du lecteur simulé : le scénario de traceMpv/scenario.json, joué sur le vrai mpv par
 * le script de trace du banc (traceMpv/trace-mpv.json), donne la même chose sur le lecteur simulé.
 * Pour chaque étape : les valeurs prises par chaque propriété, dans l'ordre (l'ordre entre deux
 * propriétés envoyées ensemble varie d'un passage de mpv à l'autre, celui d'une même propriété jamais),
 * les événements utiles à l'app dans l'ordre, si la position devient indisponible ou avance, et si la
 * commande réussit ou est refusée.
 * Ce qui dépend du fichier (durée, nom) est comparé par sa nature, pas par sa valeur.
 * Un écart ici veut dire que le banc ne voit plus l'app comme mpv la fait vivre : corriger le lecteur
 * simulé, ou enregistrer une nouvelle trace si c'est mpv qui a changé.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import scenario from './traceMpv/scenario.json';
import trace from './traceMpv/trace-mpv.json';

vi.mock('../../utils/platform', () => ({ isAndroid: () => false }));

type Note = { propriete?: string; data?: unknown; evenement?: string; reason?: string };
interface Etape { nom: string; commande?: unknown[]; propriete?: unknown[]; attente_ms: number }

/** Les événements que l'app peut lire (mpvBridge écoute « end-file ») et ceux qui jalonnent un chargement ou un saut */
const EVENEMENTS = new Set(['start-file', 'file-loaded', 'seek', 'playback-restart', 'end-file', 'idle']);

function piste(p: Record<string, unknown>): string {
  const choisie = p.selected ? '*' : '';
  return p.type === 'video' ? `video${String(p.id)}${choisie}` : `${String(p.type)}${String(p.id)}:${String(p.lang)}:${String(p.title)}${choisie}`;
}

function valeur(nom: string, data: unknown): unknown {
  if (data === undefined || data === null) return 'indisponible';
  if (nom === 'duration') return typeof data === 'number' && data > 0 ? 'durée' : data;
  if (nom === 'filename') return 'nom';
  if (nom === 'track-list' && Array.isArray(data)) return (data as Array<Record<string, unknown>>).map(piste).join(' ');
  return data;
}

function resumer(notes: Note[]) {
  const proprietes: Record<string, unknown[]> = {};
  const evenements: string[] = [];
  const positions: unknown[] = [];
  for (const n of notes) {
    if (n.propriete === 'time-pos') positions.push(n.data ?? null);
    else if (n.propriete) (proprietes[n.propriete] ??= []).push(valeur(n.propriete, n.data));
    else if (n.evenement && EVENEMENTS.has(n.evenement)) evenements.push(n.reason ? `${n.evenement}:${n.reason}` : n.evenement);
  }
  return {
    proprietes,
    evenements,
    position: { indisponible: positions.includes(null), avance: positions.some((p) => typeof p === 'number') },
  };
}

describe('lecteur simulé comparé au vrai mpv (traceMpv)', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

  it('la trace vient bien du scénario actuel (sinon : régénérer la trace avec le banc)', () => {
    expect(trace.scenario).toEqual(scenario.etapes);
    expect(trace.etapes.map((e) => e.nom)).toEqual((scenario.etapes as Etape[]).map((e) => e.nom));
  });

  it('chaque étape du scénario donne ce que mpv a donné', async () => {
    vi.resetModules();
    vi.spyOn(console, 'info').mockImplementation(() => {});
    const L = await import('../lecteurSimule');
    let notes: Note[] = [];
    // Abonnement pris avant tout, comme le module mpv au démarrage de mpv.exe
    await L.observer(scenario.proprietes, ({ name, data }) => { notes.push({ propriete: name, data }); });
    await L.ecouterEvenements((e) => { notes.push({ evenement: e.event, reason: e.reason as string | undefined }); });

    const obtenu = [];
    for (const etape of scenario.etapes as Etape[]) {
      let reponse = 'réussite';
      if (etape.commande) {
        const [nom, ...args] = etape.commande as string[];
        await L.commande(nom, args.map((a) => (a === 'fin-1' ? String(L.DUREE_SIMULEE_S - 1) : a))).catch(() => { reponse = 'refus'; });
      } else {
        const [nom, v] = etape.propriete as [string, unknown];
        await L.ecrire(nom, v).catch(() => { reponse = 'refus'; });
      }
      await vi.advanceTimersByTimeAsync(etape.attente_ms);
      // Envois partis au dernier instant de l'attente (les fausses horloges les livrent 1 ms plus tard) :
      // ils appartiennent à cette étape
      await vi.advanceTimersByTimeAsync(1);
      obtenu.push({ nom: etape.nom, reponse, ...resumer(notes) });
      notes = [];
    }
    await L.commande('stop');

    const attendu = trace.etapes.map((e) => ({ nom: e.nom, reponse: e.reponse === 'success' ? 'réussite' : 'refus', ...resumer(e.notes as Note[]) }));
    for (let i = 0; i < attendu.length; i++) expect(obtenu[i]).toEqual(attendu[i]);
  });
});
