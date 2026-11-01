/**
 * Bouton « Commencer le test de mesure », avancement et résultats du test intégré — version de mesure
 * uniquement (VITE_PERF=1 ; monté par main.tsx derrière PERF_ENABLED, absent des versions publiées).
 *
 * Styles en ligne et textes en français seulement, comme le panneau de développement : écran d'outil,
 * jamais montré aux utilisateurs de Nyx.
 */
import { useEffect, useState, type CSSProperties } from 'react';
import { readState, startRun, cancelRun, runPass, lastResults, summarize, type RunResults } from './runner';
import { PERF_VARIANTS, readVariants, applyVariants, VARIANTS_EVENT, type PerfVariant } from '../perfVariants';

const panel: CSSProperties = {
  position: 'fixed', zIndex: 100000, fontFamily: 'Inter, system-ui, sans-serif', color: '#fff',
  background: 'rgba(10, 12, 30, 0.96)', border: '1px solid rgba(255,255,255,0.2)', borderRadius: 12,
};
const button: CSSProperties = {
  font: 'inherit', fontSize: 16, fontWeight: 600, color: '#fff', background: '#3b3bd6', border: '2px solid transparent',
  borderRadius: 10, padding: '10px 18px', cursor: 'pointer', margin: 4,
};
const cell: CSSProperties = { padding: '4px 8px', borderBottom: '1px solid rgba(255,255,255,0.12)', textAlign: 'right', whiteSpace: 'nowrap' };

const ms = (v: number | null) => (v === null ? '—' : v >= 1000 ? `${(v / 1000).toFixed(1)} s` : `${v} ms`);

/**
 * Variantes de fluidité : un bouton par variante, allumé (vert) ou éteint ; effet immédiat. Une seule colonne qui
 * défile : chaque bouton s'atteint par Haut / Bas à la télécommande, même quand la liste dépasse l'écran.
 */
function Variants() {
  const [active, setActive] = useState<Set<PerfVariant>>(() => readVariants());
  // Réglage fait à distance pendant que l'écran est affiché
  useEffect(() => {
    const sync = (event: Event) => setActive(new Set((event as CustomEvent<PerfVariant[]>).detail));
    window.addEventListener(VARIANTS_EVENT, sync);
    return () => window.removeEventListener(VARIANTS_EVENT, sync);
  }, []);
  const toggle = (id: PerfVariant) => {
    const next = new Set(active);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    applyVariants(next);
    setActive(next);
  };
  return (
    <div style={{ marginTop: 8, fontSize: 13 }}>
      <div style={{ opacity: 0.85, marginBottom: 4 }}>Variantes de fluidité (essai, appliquées tout de suite) :</div>
      <div className="perf-runner-variants" style={{ display: 'flex', flexDirection: 'column', maxHeight: '60vh', overflowY: 'auto' }}>
      {PERF_VARIANTS.map((v) => (
        <button
          key={v.id}
          type="button"
          aria-pressed={active.has(v.id)}
          style={{ ...button, fontSize: 13, padding: '6px 10px', textAlign: 'left', background: active.has(v.id) ? '#1f7a4a' : '#333a55' }}
          onClick={() => toggle(v.id)}
        >
          {active.has(v.id) ? 'OUI' : 'non'} · {v.label}
        </button>
      ))}
      </div>
    </div>
  );
}

function Results({ results, onClose }: { results: RunResults; onClose: () => void }) {
  const sum = summarize(results);
  const [copied, setCopied] = useState('');
  const copy = () => {
    navigator.clipboard?.writeText(JSON.stringify(results))
      .then(() => setCopied('Copié'))
      .catch(() => setCopied('Copie impossible sur cet appareil : prenez une photo de l\'écran'));
  };
  return (
    <div className="perf-runner-results" style={{ ...panel, inset: '4vh 4vw', padding: 20, overflow: 'auto' }}>
      <h2 style={{ margin: '0 0 4px' }}>Résultats du test de mesure</h2>
      <p style={{ margin: '0 0 12px', opacity: 0.8, fontSize: 14 }}>
        {results.device} · {new Date(results.finishedAt).toLocaleString('fr-FR')} · médiane des tours 2 et 3
        (le tour 1 sert d&apos;échauffement) · premier écran au démarrage : {ms(sum.firstScreenMs)}
      </p>
      {window.innerWidth < 700 ? (
        // Écran étroit (téléphone) : une action par bloc, tout lisible sans défiler de côté
        <div style={{ fontSize: 14 }}>
          {sum.steps.map((s) => (
            <div key={s.name} style={{ padding: '8px 0', borderBottom: '1px solid rgba(255,255,255,0.12)' }}>
              <div style={{ fontWeight: 600 }}>{s.name}{s.notes.length ? ` (${s.notes.join(' ; ')})` : ''}</div>
              <div style={{ opacity: 0.9 }}>
                Prêt en {s.gesture ? '— (geste)' : ms(s.readyMs)} · figée {ms(s.blockedMs)} · saccades {s.slowFrames ?? '—'}/{s.frames ?? '—'}
                {s.keyMedianMs !== null ? ` · touche ${ms(s.keyMedianMs)} (pire ${ms(s.keyMaxMs)})` : ''}
                {' '}· maj {s.commits ?? '—'} · natifs {s.ipcCount ?? '—'}
              </div>
            </div>
          ))}
        </div>
      ) : (
      <table style={{ borderCollapse: 'collapse', fontSize: 14, width: '100%' }}>
        <thead>
          <tr>
            <th style={{ ...cell, textAlign: 'left' }}>Action</th>
            <th style={cell}>Prêt en</th>
            <th style={cell}>App figée</th>
            <th style={cell}>Images en retard</th>
            <th style={cell}>Touche (médiane / pire)</th>
            <th style={cell}>Mises à jour</th>
            <th style={cell}>Appels natifs</th>
          </tr>
        </thead>
        <tbody>
          {sum.steps.map((s) => (
            <tr key={s.name}>
              <td style={{ ...cell, textAlign: 'left', whiteSpace: 'normal' }}>{s.name}{s.notes.length ? ` (${s.notes.join(' ; ')})` : ''}</td>
              <td style={cell}>{s.gesture ? 'geste' : ms(s.readyMs)}</td>
              <td style={cell}>{ms(s.blockedMs)}</td>
              <td style={cell}>{s.slowFrames ?? '—'} / {s.frames ?? '—'}</td>
              <td style={cell}>{s.keyMedianMs === null ? '—' : `${ms(s.keyMedianMs)} / ${ms(s.keyMaxMs)}`}</td>
              <td style={cell}>{s.commits ?? '—'}</td>
              <td style={cell}>{s.ipcCount ?? '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
      )}
      <p style={{ fontSize: 13, opacity: 0.75 }}>
        « Prêt en » : du geste à l&apos;écran affiché (« geste » : défilement, frappe ou série de touches,
        jugés sur les deux colonnes suivantes). « App figée » : temps où l&apos;app ne répondait plus.
        « Images en retard » : images d&apos;animation affichées en retard (saccades), sur le total.
        « Touche » : délai entre l&apos;appui et le déplacement de la sélection.
      </p>
      <div>
        <button type="button" style={button} onClick={copy}>Copier les résultats</button>
        <button type="button" style={{ ...button, background: '#333a55' }} onClick={onClose}>Fermer</button>
        {copied && <span style={{ marginLeft: 8 }}>{copied}</span>}
      </div>
    </div>
  );
}

export function PerfRunner(): JSX.Element | null {
  const [running] = useState(() => !!readState()?.running);
  const [status, setStatus] = useState<string>(() => readState()?.status ?? '');
  const [onProfiles, setOnProfiles] = useState(false);
  const [results, setResults] = useState<RunResults | null>(null);

  // Écran des profils affiché ? (le bouton n'apparaît que là)
  useEffect(() => {
    const timer = setInterval(() => setOnProfiles(!!document.querySelector('.profile-selector')), 500);
    return () => clearInterval(timer);
  }, []);

  // Test en cours : attendre l'écran des profils, puis jouer le tour
  useEffect(() => {
    if (!running) return;
    let stopped = false;
    const wait = setInterval(() => {
      if (stopped || !document.querySelector('.profile-card:not(.profile-card--new)')) return;
      clearInterval(wait);
      void runPass((s) => {
        setStatus(s);
        if (s === 'Terminé') setResults(lastResults());
      });
    }, 500);
    return () => { stopped = true; clearInterval(wait); };
  }, [running]);

  if (results) return <Results results={results} onClose={() => setResults(null)} />;

  if (running && status !== 'Terminé') {
    return (
      <div className="perf-runner-status" style={{ ...panel, top: 12, left: '50%', transform: 'translateX(-50%)', padding: '8px 14px', display: 'flex', alignItems: 'center', gap: 12 }}>
        <span>Test de mesure — {status || 'démarrage'} · ne touchez à rien</span>
        <button type="button" style={{ ...button, background: '#8a2b2b', padding: '6px 12px', fontSize: 14 }} onClick={() => { cancelRun(); location.reload(); }}>
          Arrêter le test
        </button>
      </div>
    );
  }

  if (!onProfiles) return null;
  const previous = lastResults();
  return (
    // À gauche, à côté des profils et non par-dessus : posé sur les boutons de la page, il les cachait et la
    // télécommande y sautait au lieu de suivre la liste. Zone à part : on y entre par Gauche depuis les profils, Haut et
    // Bas y restent, Droite en ressort.
    <div className="perf-runner-start" data-nav-zone="aside" style={{ ...panel, top: '50%', left: 16, transform: 'translateY(-50%)', width: 'min(30rem, 30vw)', padding: 12 }}>
      <div style={{ fontSize: 14, opacity: 0.85, marginBottom: 6 }}>
        Nyx Mesure : le test entre dans le premier profil et joue seul les parcours, 3 fois (environ 10 à 20 min).
      </div>
      <button type="button" style={button} onClick={startRun}>Commencer le test de mesure</button>
      {previous && (
        <button type="button" style={{ ...button, background: '#333a55' }} onClick={() => setResults(previous)}>
          Derniers résultats
        </button>
      )}
      <Variants />
    </div>
  );
}
