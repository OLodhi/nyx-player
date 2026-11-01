/**
 * Test de mesure intégré (audit performance) — version de mesure uniquement (VITE_PERF=1).
 *
 * L'utilisateur lance le test depuis l'écran des profils ; Nyx joue alors seul les parcours (mêmes
 * règles que l'outil de mesure Windows : on ne fait que NAVIGUER, jamais le lecteur, jamais de
 * modification), 3 tours dont le premier d'échauffement, l'app rechargée entre deux tours (l'état du
 * test est gardé dans le stockage local). Chaque étape note : temps jusqu'à l'écran prêt, temps où
 * l'app ne répond plus (tâches longues), images en retard, mises à jour de React, appels au cœur natif.
 */
import { isTv, isMobile, isAndroid } from '../../utils/platform';
import type { PerfCounters } from '../perfHook';
import { readVariants } from '../perfVariants';

export const STATE_KEY = 'nyx_perf_run';
export const RESULTS_KEY = 'nyx_perf_results';
const PASSES = 3;
/** Pause entre deux tours : laisser refroidir un Chromecast (il ralentit en chauffant). */
const COOLDOWN_MS = isTv() ? 30000 : 8000;

export interface StepResult {
  name: string;
  readyMs: number;
  blockedMs: number;
  longTaskMaxMs: number;
  frames: number;
  slowFrames: number;
  worstFrameMs: number;
  commits: number;
  /** null sur Android : Tauri y passe ses appels par postMessage, invisibles sans modifier Nyx. */
  ipcCount: number | null;
  ipcMs: number | null;
  keyMedianMs?: number;
  keyMaxMs?: number;
  note?: string;
  gesture?: boolean;
}

export interface RunState {
  running: boolean;
  pass: number;
  startedAt: string;
  device: string;
  passes: { firstScreenMs: number | null; steps: StepResult[] }[];
  status: string;
}

const SAFE_CARD = '.carousel-card:not(:has(.card-play-button)):not(:has(.card-progress-bar))';

// ---------------------------------------------------------------- outils

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const counters = (): PerfCounters => window.__nyxPerfCounters ?? { longTasks: [], commits: 0, ipcCount: 0, ipcMs: 0 };
const $ = (sel: string) => document.querySelector<HTMLElement>(sel);

async function waitFor(test: () => boolean, maxMs = 15000): Promise<boolean> {
  const t0 = performance.now();
  while (performance.now() - t0 < maxMs) {
    if (test()) return true;
    await sleep(30);
  }
  return false;
}

/** Deux images plus tard : ce que l'étape a changé est à l'écran. */
const nextPaint = () => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));

function click(sel: string): boolean {
  const el = $(sel);
  if (!el) return false;
  el.click();
  return true;
}

/** Touche de la télécommande simulée (flèches, retour) ; jamais OK : il pourrait lancer la lecture. */
function key(k: 'ArrowUp' | 'ArrowDown' | 'ArrowLeft' | 'ArrowRight' | 'Escape'): void {
  const target = document.activeElement ?? document.body;
  target.dispatchEvent(new KeyboardEvent('keydown', { key: k, code: k, bubbles: true, cancelable: true }));
  target.dispatchEvent(new KeyboardEvent('keyup', { key: k, code: k, bubbles: true, cancelable: true }));
}

/** Plus grand conteneur qui défile à l'écran (l'accueil, une liste, le guide). */
function scroller(root: ParentNode = document): HTMLElement {
  const all = [...root.querySelectorAll<HTMLElement>('*')].filter((e) => {
    const s = getComputedStyle(e);
    return /(auto|scroll)/.test(s.overflowY) && e.scrollHeight > e.clientHeight + 20 && e.clientHeight > 100;
  });
  return all.sort((a, b) => b.clientHeight * b.clientWidth - a.clientHeight * a.clientWidth)[0]
    ?? (document.scrollingElement as HTMLElement);
}

async function scrollBy(el: HTMLElement, dy: number, dx = 0, times = 4, gapMs = 450): Promise<void> {
  for (let i = 0; i < times; i++) {
    el.scrollBy({ top: dy, left: dx, behavior: 'smooth' });
    await sleep(gapMs);
  }
}

/** Écran calme : ni tâche longue ni appel natif pendant 600 ms (5 s au plus). */
async function settle(): Promise<void> {
  const t0 = performance.now();
  let last = { lt: counters().longTasks.length, ipc: counters().ipcCount };
  let calmSince = performance.now();
  while (performance.now() - t0 < 5000) {
    await sleep(100);
    const now = { lt: counters().longTasks.length, ipc: counters().ipcCount };
    if (now.lt !== last.lt || now.ipc !== last.ipc) calmSince = performance.now();
    last = now;
    if (performance.now() - calmSince >= 600) break;
  }
}

// ---------------------------------------------------------------- mesure d'une étape

/** `gesture` : geste qui dure par construction (défilement, frappe, série de touches) : son « prêt en »
 *  n'est que la durée du geste, non affichée ; seuls comptent les blocages et les images en retard. */
interface StepOptions { ready?: () => boolean; readyMaxMs?: number; keyLatencies?: number[]; gesture?: boolean }

async function measure(name: string, action: () => Promise<unknown> | unknown, opts: StepOptions = {}): Promise<StepResult> {
  await settle();
  const c = counters();
  const s0 = { lt: c.longTasks.length, commits: c.commits, ipcCount: c.ipcCount, ipcMs: c.ipcMs };
  const deltas: number[] = [];
  let running = true;
  let last = performance.now();
  const tick = (t: number) => {
    if (!running) return;
    deltas.push(t - last);
    last = t;
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);

  const t0 = performance.now();
  const note = await action();
  let readyOk = true;
  if (opts.ready) readyOk = await waitFor(opts.ready, opts.readyMaxMs ?? 15000);
  await nextPaint();
  const readyMs = performance.now() - t0;
  await settle();
  running = false;

  const lt = counters().longTasks.slice(s0.lt);
  const frames = deltas.slice(1);
  const keys = opts.keyLatencies?.slice().sort((a, b) => a - b);
  return {
    name,
    readyMs: Math.round(readyMs),
    blockedMs: Math.round(lt.reduce((s, t) => s + Math.max(0, t.duration - 50), 0)),
    longTaskMaxMs: Math.round(lt.reduce((m, t) => Math.max(m, t.duration), 0)),
    frames: frames.length,
    slowFrames: frames.filter((d) => d > 25).length,
    worstFrameMs: Math.round(frames.reduce((m, d) => Math.max(m, d), 0)),
    commits: counters().commits - s0.commits,
    ipcCount: isAndroid() ? null : counters().ipcCount - s0.ipcCount,
    ipcMs: isAndroid() ? null : Math.round(counters().ipcMs - s0.ipcMs),
    ...(opts.gesture ? { gesture: true } : {}),
    ...(keys?.length ? { keyMedianMs: Math.round(keys[Math.floor(keys.length / 2)]), keyMaxMs: Math.round(keys[keys.length - 1]) } : {}),
    ...(typeof note === 'string' ? { note } : !readyOk ? { note: 'écran attendu non apparu' } : {}),
  };
}

// ---------------------------------------------------------------- déplacements

async function goTab(tab: string): Promise<void> {
  if ($('.detail-overlay')) await closeDetail();
  click(`[data-tab="${tab}"]`);
  await sleep(900);
  await settle();
}

async function closeDetail(): Promise<void> {
  if (isTv()) key('Escape');
  else click('.detail-overlay .back-button');
  await waitFor(() => !$('.detail-overlay'), 8000);
}

function clickCard(row: number, card: number): string | null {
  const rows = [...document.querySelectorAll('.content-carousel')];
  const inRow = rows[row] ? [...rows[row].querySelectorAll<HTMLElement>(SAFE_CARD)] : [];
  const all = [...document.querySelectorAll<HTMLElement>(SAFE_CARD)];
  const el = inRow[card] ?? inRow[0] ?? all[card] ?? all[0];
  if (!el) return 'aucune affiche à ouvrir';
  el.scrollIntoView({ block: 'center', inline: 'nearest' });
  el.click();
  return null;
}

/** Appuis de touche et délai jusqu'à ce que la sélection ait bougé à l'écran. */
async function pressAndTime(k: 'ArrowUp' | 'ArrowDown' | 'ArrowLeft' | 'ArrowRight', count: number, gapMs: number, out: number[]): Promise<void> {
  for (let i = 0; i < count; i++) {
    const before = document.activeElement;
    const t0 = performance.now();
    key(k);
    await waitFor(() => document.activeElement !== before, 1000);
    await nextPaint();
    out.push(performance.now() - t0);
    await sleep(gapMs);
  }
}

function typeInto(input: HTMLInputElement, text: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  setter?.call(input, text);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

// ---------------------------------------------------------------- parcours

async function scenarios(): Promise<StepResult[]> {
  const steps: StepResult[] = [];
  const tv = isTv();

  // Accueil : modes et défilement
  await goTab('dashboard');
  for (const [mode, label] of [['films', 'Films'], ['series', 'Séries'], ['suggestions', 'Suggestions']]) {
    steps.push(await measure(`Accueil : passage à « ${label} »`, () => { click(`[data-mode="${mode}"]`); }));
  }
  if (tv) {
    const lat: number[] = [];
    steps.push(await measure('Accueil : descente dans les rangées (4 × ↓)', () => pressAndTime('ArrowDown', 4, 400, lat), { keyLatencies: lat, gesture: true }));
    const lat2: number[] = [];
    steps.push(await measure('Télécommande : 15 × → dans une rangée', () => pressAndTime('ArrowRight', 15, 250, lat2), { keyLatencies: lat2, gesture: true }));
    const lat3: number[] = [];
    steps.push(await measure('Télécommande : flèche maintenue (20 × ←)', () => pressAndTime('ArrowLeft', 20, 60, lat3), { keyLatencies: lat3, gesture: true }));
    const lat4: number[] = [];
    steps.push(await measure('Accueil : remontée (4 × ↑)', () => pressAndTime('ArrowUp', 4, 400, lat4), { keyLatencies: lat4, gesture: true }));
  } else {
    const el = scroller();
    steps.push(await measure('Accueil : défilement vers le bas', () => scrollBy(el, el.clientHeight * 0.8), { gesture: true }));
    steps.push(await measure('Accueil : retour en haut', () => scrollBy(el, -el.clientHeight * 0.8), { gesture: true }));
  }

  // Fiches : 2 films, 1 série, à des rangées et des places différentes
  for (const [i, [mode, row, card]] of ([['films', 0, 0], ['films', 1, 2], ['series', 0, 1]] as const).entries()) {
    click(`[data-mode="${mode}"]`);
    await sleep(900);
    await settle();
    const kind = mode === 'films' ? 'film' : 'série';
    steps.push(await measure(`Fiche ${kind} n° ${i + 1} : ouverture`, () => clickCard(row, card), {
      ready: () => !!$('.detail-overlay .back-button'),
    }));
    steps.push(await measure(`Fiche ${kind} n° ${i + 1} : retour`, () => closeDetail(), { ready: () => !$('.detail-overlay') }));
  }

  // Guide TV
  await goTab('live');
  const guideBtn = isMobile() ? '.live-tv-bar__mode:nth-child(2)' : '.tv-categories-sidebar__switch-btn:nth-child(2)';
  const listBtn = isMobile() ? '.live-tv-bar__mode:nth-child(1)' : '.tv-categories-sidebar__switch-btn:nth-child(1)';
  steps.push(await measure('Guide TV : ouverture', () => (click(guideBtn) ? null : 'bouton du guide introuvable'), {
    ready: () => !!$('.guide-tv-grid, .guide-tv-grid__error'), readyMaxMs: 30000,
  }));
  const grid = $('.guide-tv-grid');
  if (grid) {
    const el = scroller(grid);
    steps.push(await measure('Guide TV : défilement', () => scrollBy(el, el.clientHeight * 0.6), { gesture: true }));
  }
  click(listBtn);
  await sleep(600);

  // Recherche (clavier du téléphone et de la TV non simulé : saisie directe dans le champ)
  await goTab('search');
  const input = $('#global-search-input') as HTMLInputElement | null;
  if (input) {
    steps.push(await measure('Recherche : « the matrix », une lettre toutes les 150 ms', async () => {
      const text = 'the matrix';
      for (let i = 1; i <= text.length; i++) {
        typeInto(input, text.slice(0, i));
        await sleep(150);
      }
      await sleep(800);
    }, { gesture: true }));
    typeInto(input, '');
    input.blur();
  }

  await goTab('dashboard');
  return steps;
}

// ---------------------------------------------------------------- état et enchaînement des tours

export function readState(): RunState | null {
  try {
    const raw = localStorage.getItem(STATE_KEY);
    return raw ? (JSON.parse(raw) as RunState) : null;
  } catch {
    return null;
  }
}

function writeState(state: RunState | null): void {
  try {
    if (state) localStorage.setItem(STATE_KEY, JSON.stringify(state));
    else localStorage.removeItem(STATE_KEY);
  } catch {
    // Stockage indisponible : le test ne peut pas enchaîner ses tours (signalé à l'écran)
  }
}

function deviceLabel(): string {
  const kind = isTv() ? 'TV' : isMobile() ? 'Téléphone' : isAndroid() ? 'Android' : 'Windows';
  return `${kind} — écran ${window.screen.width}×${window.screen.height} (×${window.devicePixelRatio})`;
}

/** Lancé depuis le bouton de l'écran des profils. */
export function startRun(): void {
  writeState({ running: true, pass: 1, startedAt: new Date().toISOString(), device: deviceLabelWithVariants(), passes: [], status: 'Tour 1 / 3 (échauffement)' });
  location.reload();
}

export function cancelRun(): void {
  writeState(null);
}

/**
 * Un tour : appelé au chargement de l'app quand un test est en cours, sur l'écran des profils.
 * `onStatus` affiche l'avancement.
 */
export async function runPass(onStatus: (s: string) => void): Promise<void> {
  const state = readState();
  if (!state?.running) return;
  const label = `Tour ${state.pass} / ${PASSES}${state.pass === 1 ? ' (échauffement)' : ''}`;
  onStatus(`${label} : entrée dans le profil`);

  const firstScreen = performance.getEntriesByName('nyx:first-screen')[0]?.startTime ?? null;
  const steps: StepResult[] = [];
  steps.push(await measure('Entrée dans le profil jusqu\'à l\'accueil prêt', () => {
    click('.profile-card:not(.profile-card--new)');
  }, {
    ready: () => performance.getEntriesByName('nyx:home-data-ready').length > 0 && !!$('.main-ui'),
    readyMaxMs: 60000,
  }));

  onStatus(`${label} : parcours`);
  try {
    steps.push(...await scenarios());
  } catch (e) {
    steps.push({ name: 'Erreur du test', readyMs: 0, blockedMs: 0, longTaskMaxMs: 0, frames: 0, slowFrames: 0, worstFrameMs: 0, commits: 0, ipcCount: 0, ipcMs: 0, note: String(e) });
  }

  const next: RunState = { ...state, passes: [...state.passes, { firstScreenMs: firstScreen === null ? null : Math.round(firstScreen), steps }] };
  if (state.pass >= PASSES) {
    const results = { device: state.device, startedAt: state.startedAt, finishedAt: new Date().toISOString(), passes: next.passes };
    saveResults(results);
    writeState(null);
    onStatus('Terminé');
    return;
  }
  next.pass += 1;
  next.status = `Tour ${next.pass} / ${PASSES}`;
  writeState(next);
  for (let left = COOLDOWN_MS; left > 0; left -= 1000) {
    onStatus(`${label} terminé. Pause avant le tour suivant : ${Math.ceil(left / 1000)} s`);
    await sleep(1000);
    if (!readState()?.running) return; // test arrêté pendant la pause
  }
  location.reload();
}

// ---------------------------------------------------------------- résultats

/** Appareil, et variantes de fluidité actives (perfVariants.ts) : chaque résultat dit ce qui était essayé. */
function deviceLabelWithVariants(): string {
  const variants = [...readVariants()];
  return variants.length ? `${deviceLabel()} · variantes : ${variants.join(', ')}` : deviceLabel();
}

export interface RunResults {
  device: string;
  startedAt: string;
  finishedAt: string;
  passes: { firstScreenMs: number | null; steps: StepResult[] }[];
}

function saveResults(results: RunResults): void {
  try {
    const all = JSON.parse(localStorage.getItem(RESULTS_KEY) ?? '[]') as RunResults[];
    localStorage.setItem(RESULTS_KEY, JSON.stringify([results, ...all].slice(0, 5)));
  } catch {
    // Stockage plein ou indisponible : les résultats restent à l'écran
  }
  // Une ligne dans la console de la page : lisible avec la version -Debogage branchée (la version
  // optimisée ne recopie pas la console dans le journal de l'appareil).
  console.info(`NYX_PERF_RESULT ${JSON.stringify(results)}`);
}

export function lastResults(): RunResults | null {
  try {
    return (JSON.parse(localStorage.getItem(RESULTS_KEY) ?? '[]') as RunResults[])[0] ?? null;
  } catch {
    return null;
  }
}

const median = (v: number[]) => {
  const s = v.filter(Number.isFinite).sort((a, b) => a - b);
  if (!s.length) return null;
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
};

/** Médiane par étape des tours gardés (le premier, d'échauffement, est jeté). */
export function summarize(results: RunResults) {
  const kept = results.passes.slice(1);
  const names = [...new Set(kept.flatMap((p) => p.steps.map((s) => s.name)))];
  return {
    firstScreenMs: median(kept.map((p) => p.firstScreenMs ?? NaN)),
    steps: names.map((name) => {
      const list = kept.map((p) => p.steps.find((s) => s.name === name)).filter((s): s is StepResult => !!s);
      const pick = (f: (s: StepResult) => number | undefined) => median(list.map((s) => f(s) ?? NaN));
      return {
        name,
        gesture: list.some((s) => s.gesture),
        readyMs: list.some((s) => s.gesture) ? null : pick((s) => s.readyMs),
        blockedMs: pick((s) => s.blockedMs),
        slowFrames: pick((s) => s.slowFrames),
        frames: pick((s) => s.frames),
        commits: pick((s) => s.commits),
        ipcCount: pick((s) => s.ipcCount ?? undefined),
        keyMedianMs: pick((s) => s.keyMedianMs),
        keyMaxMs: pick((s) => s.keyMaxMs),
        notes: [...new Set(list.map((s) => s.note).filter(Boolean))] as string[],
      };
    }),
  };
}
