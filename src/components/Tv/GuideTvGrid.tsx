/**
 * GuideTvGrid — Composant principal du Guide TV (timeline horizontale).
 *
 * Structure :
 * - Header sticky : coin vide + labels horaires
 * - Body scrollable : colonne chaînes sticky (logos) + rows programmes (position: absolute)
 * - CurrentTimeMarker : ligne rouge isolée (0 re-render parent)
 * - Séparateurs de date aux passages de minuit
 *
 * Constantes layout (plan §6) :
 * - REM_PER_MINUTE = 0.25 (1h = 15rem, 24h = 360rem)
 * - ROW_HEIGHT_REM = 4
 * - CHANNEL_COL_WIDTH_REM = 10
 *
 * @param channels — Chaînes de la catégorie sélectionnée
 * @param onChannelClick — Callback au clic sur un logo de chaîne
 * @param programs — Map channelId → EpgProgram[] (depuis useGuideTvData)
 * @param originTs — Minuit UTC du jour courant (ancre CSS)
 * @param totalMinutes — Largeur totale de la timeline en minutes
 * @param isLoading — Chargement en cours
 * @param error — Message d'erreur ou null
 * @param loadDay — Fonction de lazy-load d'un jour additionnel
 * @param loadedDays — Set des jours déjà chargés
 *
 * Télécommande (Android TV) : useGuideTvRemote. Flèches entre chaînes et programmes, OK lance la chaîne.
 *
 * Seules les chaînes et les heures à l'écran (plus une marge) sont dessinées (guideWindow.ts) ; des
 * cales gardent la taille de la grille entière. La télécommande fait dessiner la case qu'elle vise
 * quand elle est hors de la fenêtre (`revealCell`).
 */

import { cancelScroll } from '../../utils/spatialNavigation/scrollAnimator';
import { memo, type ReactElement, useEffect, useLayoutEffect, useRef, useCallback, useMemo, useState } from 'react';
import { flushSync } from 'react-dom';
import { useTranslation } from 'react-i18next';
import type { IptvStream } from '../../types/iptv';
import type { EpgProgram } from '../../services/epgService';
import { remToPx } from '../../utils/cssHelpers';
import { CurrentTimeMarker } from './CurrentTimeMarker';
import { formatClock } from '../../utils/timeHelpers';
import { isTv } from '../../utils/platform';
import { useGuideTvRemote } from '../../hooks/useGuideTvRemote';
import { nextLiveChangeSec } from './guideLive';
import { guideWindow, inTimeWindow, sameWindow, type GuideView, type GuideWindow } from './guideWindow';
import type { GuideCell } from '../../utils/guideTvNavigation';
import './GuideTvGrid.css';

// ============================================================================
// CONSTANTS (Plan §6 L171-173)
// ============================================================================

/** rem par minute de programme (1h = 15rem, 24h = 360rem) */
const REM_PER_MINUTE = 0.25;

// ROW_HEIGHT_REM = 4rem et CHANNEL_COL_WIDTH_REM = 10rem sont définis dans GuideTvGrid.css

/** Secondes par jour */
const SECONDS_PER_DAY = 86400;

/** Seuil de scroll boundary pour déclencher le lazy-load (en px) */
const SCROLL_BOUNDARY_PX = 300;

/** Programme « en direct » : au plus un redessin par minute (même rythme que le repère de l'heure),
 *  même si des chaînes changent de programme à quelques secondes d'écart */
const MIN_LIVE_WAIT_MS = 60_000;
/** Délai maximal avant de relire l'heure (horloge de l'appareil changée) */
const MAX_LIVE_WAIT_MS = 60 * 60_000;

/** Hauteur d'une rangée (`--guide-row-height`) quand la page n'est pas mise en page */
const FALLBACK_ROW_REM = 4;
/** Taille supposée du guide tant qu'il n'est pas mis en page : la toile TV */
const FALLBACK_VIEW = { width: 1280, height: 720 };

// ============================================================================
// TYPES
// ============================================================================

interface GuideTvGridProps {
  channels: IptvStream[];
  onChannelClick: (channel: IptvStream) => void;
  programs: Map<string, EpgProgram[]>;
  originTs: number;
  totalMinutes: number;
  isLoading: boolean;
  error: string | null;
  loadDay: (dayMidnightTs: number) => Promise<void>;
  loadedDays: Set<number>;
}

// ============================================================================
// HELPERS
// ============================================================================

/**
 * Calcule le style inline (left, width) d'un bloc programme.
 * Plan §6 L178-185.
 */
function getProgramStyle(program: EpgProgram, originTs: number): { left: string; width: string } {
  const startMin = Math.max(0, (program.startTs - originTs) / 60);
  const durationMin = (program.stopTs - program.startTs) / 60;
  return {
    left: `${startMin * REM_PER_MINUTE}rem`,
    width: `${Math.max(0.5, durationMin * REM_PER_MINUTE)}rem`,
  };
}

/** Programme dans la grille : seulement les cases à l'écran ou près de l'écran. */
interface GuideRowProps {
  row: number;
  channel: IptvStream;
  channelPrograms: EpgProgram[] | undefined;
  originTs: number;
  fromTs: number;
  toTs: number;
  nowSec: number;
  tv: boolean;
}

/**
 * Rangée des programmes d'une chaîne. Redessinée seulement quand sa fenêtre d'heures, l'heure du
 * direct ou ses programmes changent (pas quand d'autres rangées entrent à l'écran).
 */
const GuideRow = memo(function GuideRow({ row, channel: ch, channelPrograms, originTs, fromTs, toTs, nowSec, tv }: GuideRowProps) {
  // Clé stable quand un jour précédent est chargé en tête (l'index décalait toutes les clés :
  // programmes recréés, sélection de la télécommande perdue). Comptée sur toute la liste, pour ne pas
  // changer quand la fenêtre avance.
  const seen = new Map<number, number>();
  const cells: ReactElement[] = [];
  for (const prog of channelPrograms ?? []) {
    // Rien avant l'origine : un programme fini la veille serait empilé à gauche (left: 0), invisible
    // mais dessiné, et doublait le nombre d'éléments dès le jour précédent chargé
    if (prog.stopTs <= originTs) continue;
    const twin = seen.get(prog.startTs) ?? 0;
    seen.set(prog.startTs, twin + 1);
    if (!inTimeWindow(prog.startTs, prog.stopTs, { fromTs, toTs })) continue;
    const isLive = prog.startTs <= nowSec && prog.stopTs > nowSec;
    cells.push(
      <div
        key={`${prog.channelId}-${prog.startTs}-${twin}`}
        className={`guide-program${isLive ? ' guide-program--live' : ''}`}
        data-testid="guide-program"
        data-guide-row={row}
        data-guide-start={prog.startTs}
        tabIndex={tv ? -1 : undefined}
        style={getProgramStyle(prog, originTs)}
        title={`${prog.title} (${formatClock(prog.startTs)} - ${formatClock(prog.stopTs)})`}
      >
        <span className="guide-program__title">{prog.title}</span>
        <span className="guide-program__time">
          {formatClock(prog.startTs)} – {formatClock(prog.stopTs)}
        </span>
      </div>,
    );
  }
  return (
    <div className="guide-tv-grid__row" data-testid="guide-row" aria-label={ch.name}>
      {cells}
    </div>
  );
});

interface GuideChannelCellProps {
  row: number;
  channel: IptvStream;
  tv: boolean;
  onChannelClick: (channel: IptvStream) => void;
}

const GuideChannelCell = memo(function GuideChannelCell({ row, channel: ch, tv, onChannelClick }: GuideChannelCellProps) {
  return (
    <div
      className="guide-tv-grid__channel-cell"
      data-testid="guide-channel"
      data-guide-row={row}
      data-guide-channel=""
      tabIndex={tv ? -1 : undefined}
      aria-label={ch.name}
      onClick={() => onChannelClick(ch)}
      title={ch.name}
    >
      {ch.stream_icon ? (
        <img
          className="guide-tv-grid__channel-logo"
          src={ch.stream_icon}
          alt=""
          loading="lazy"
          decoding="async"
        />
      ) : (
        <div className="guide-tv-grid__channel-logo" />
      )}
      <span className="guide-tv-grid__channel-name">{ch.name}</span>
    </div>
  );
});

/** Cale qui tient la place de `rows` rangées non dessinées. */
function RowsSpacer({ rows }: { rows: number }) {
  if (rows <= 0) return null;
  return <div className="guide-tv-grid__spacer" aria-hidden style={{ height: `calc(${rows} * var(--guide-row-height))` }} />;
}

/** Nombre positif et fini, sinon `fallback` (page sans mise en page : tests, guide caché). */
function positive(value: number, fallback: number): number {
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

/** Fenêtre du premier rendu, avant la mise en page : une toile TV calée sur maintenant (comme à l'ouverture). */
function openingWindow(rowCount: number, originTs: number): GuideWindow {
  const pxPerMinute = positive(remToPx(REM_PER_MINUTE), 4);
  const scrollLeft = (Date.now() / 1000 - originTs) / 60 * pxPerMinute - FALLBACK_VIEW.width / 2;
  return guideWindow({
    scrollTop: 0,
    scrollLeft,
    ...FALLBACK_VIEW,
    rowPx: positive(remToPx(FALLBACK_ROW_REM), 64),
    pxPerMinute,
  }, rowCount, originTs);
}

/** Hauteur d'une rangée dessinée (0 sans mise en page). Le conteneur entier compterait la marge du
 *  bas de la colonne des chaînes sur téléphone. */
function rowHeight(rows: HTMLElement | null): number {
  return rows?.querySelector<HTMLElement>('.guide-tv-grid__row')?.offsetHeight ?? 0;
}

/** Case d'un élément du guide (`data-guide-row`, `data-guide-start`). */
function cellOf(element: HTMLElement): GuideCell {
  const start = element.dataset.guideStart;
  return { row: Number(element.dataset.guideRow), startTs: start === undefined ? null : Number(start) };
}

/**
 * Formate une date de séparateur en locale (ex: "Sam. 12 Avr.").
 * Utilise Intl.DateTimeFormat (locale-aware nativement — convention i18n §9).
 */
function formatDateSeparator(epochSeconds: number): string {
  const d = new Date(epochSeconds * 1000);
  return new Intl.DateTimeFormat(undefined, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  }).format(d);
}

/**
 * Génère les labels horaires pour la timeline header.
 */
function generateHourLabels(originTs: number, totalMinutes: number): string[] {
  const totalHours = Math.ceil(totalMinutes / 60);
  const labels: string[] = [];

  for (let h = 0; h < totalHours; h++) {
    const ts = originTs + h * 3600;
    labels.push(formatClock(ts));
  }

  return labels;
}

// ============================================================================
// COMPONENT
// ============================================================================

export function GuideTvGrid({
  channels,
  onChannelClick,
  programs,
  originTs,
  totalMinutes,
  isLoading,
  error,
  loadDay,
  loadedDays,
}: GuideTvGridProps) {
  const { t } = useTranslation('tv');
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const headerTimelineRef = useRef<HTMLDivElement>(null);
  // Corps du guide pour la télécommande : il n'existe qu'une fois les programmes chargés
  const [bodyElement, setBodyElement] = useState<HTMLDivElement | null>(null);
  const setBody = useCallback((element: HTMLDivElement | null) => {
    bodyRef.current = element;
    setBodyElement(element);
  }, []);
  const tv = isTv();
  const rowsRef = useRef<HTMLDivElement>(null);
  /** Vue calée sur maintenant (défilement d'ouverture fait) */
  const scrolledToNow = useRef(false);
  /** Case que la télécommande fait dessiner hors de la fenêtre, gardée jusqu'à ce qu'elle soit sélectionnée */
  const revealed = useRef<GuideCell | null>(null);
  /** Hauteur de rangée et largeur d'une minute, relues à la mise en page (pas à chaque défilement) */
  const metrics = useRef({ rowPx: 0, pxPerMinute: 0 });
  const rowCount = channels.length;

  /** Ce que l'on voit du guide : avant la mise en page, une toile TV calée sur maintenant. */
  const readView = useCallback((): { view: GuideView; allTime: boolean } => {
    const body = bodyRef.current;
    const { rowPx, pxPerMinute } = metrics.current;
    const perMinute = positive(pxPerMinute, positive(remToPx(REM_PER_MINUTE), 4));
    const row = positive(rowPx, positive(remToPx(FALLBACK_ROW_REM), 64));
    const laidOut = !!body && (body.clientWidth > 0 || body.clientHeight > 0);
    const width = laidOut ? body.clientWidth : FALLBACK_VIEW.width;
    const height = laidOut ? body.clientHeight : FALLBACK_VIEW.height;
    const nowLeft = (Date.now() / 1000 - originTs) / 60 * perMinute - width / 2;
    return {
      view: {
        scrollTop: body?.scrollTop ?? 0,
        scrollLeft: laidOut && scrolledToNow.current ? body.scrollLeft : nowLeft,
        width,
        height,
        rowPx: row,
        pxPerMinute: perMinute,
      },
      // Corps présent mais sans taille (page de test, guide caché) : on ne devine pas l'heure visible
      allTime: !!body && !laidOut,
    };
  }, [originTs]);

  const computeWindow = useCallback((): GuideWindow => {
    const body = bodyRef.current;
    const pins: GuideCell[] = [];
    // Case sur le parcours de la télécommande (la sélection quand elle est dans le guide) : elle doit
    // rester dessinée, sinon le focus tomberait et le retour depuis la barre des catégories serait perdu
    const entry = body?.querySelector<HTMLElement>('[data-guide-row][tabindex="0"]');
    if (entry) pins.push(cellOf(entry));
    const pending = revealed.current;
    if (pending) {
      if (entry && cellOf(entry).row === pending.row && cellOf(entry).startTs === pending.startTs) revealed.current = null;
      else pins.push(pending);
    }
    const { view, allTime } = readView();
    return guideWindow(view, rowCount, originTs, pins, allTime);
  }, [readView, rowCount, originTs]);

  const [win, setWin] = useState<GuideWindow>(() => openingWindow(rowCount, originTs));
  const updateWindow = useCallback((sync = false) => {
    const next = computeWindow();
    const apply = () => setWin((prev) => (sameWindow(prev, next) ? prev : next));
    if (sync) flushSync(apply);
    else apply();
  }, [computeWindow]);

  /** Fait dessiner une case hors de la fenêtre. `sync` : dessinée au retour (touche en cours). */
  const revealCell = useCallback((cell: GuideCell, sync: boolean) => {
    revealed.current = cell;
    // Reprise loin de la vue (rechargement) : la vue saute d'abord sur la rangée, qui sera de toute
    // façon centrée sans animation ; sinon toutes les rangées entre la vue et elle seraient dessinées
    const body = bodyRef.current;
    if (!sync && body && body.clientHeight > 0) {
      const { rowPx } = metrics.current;
      if (rowPx > 0) cancelScroll(body); // écriture directe : pas un ancrage de l'animation en cours
      if (rowPx > 0) body.scrollTop = Math.max(0, (cell.row + 0.5) * rowPx - body.clientHeight / 2);
    }
    updateWindow(sync);
  }, [updateWindow]);

  // Nouvelle grille (rechargement, autre catégorie) : une case à faire dessiner l'était dans l'ancienne
  useLayoutEffect(() => {
    revealed.current = null;
  }, [bodyElement]);

  // Mise en page : hauteur de rangée et largeur d'une minute, puis la fenêtre (avant l'affichage)
  useLayoutEffect(() => {
    const rows = rowsRef.current;
    metrics.current = {
      rowPx: rowHeight(rows),
      pxPerMinute: remToPx(REM_PER_MINUTE),
    };
    updateWindow();
  }, [bodyElement, rowCount, totalMinutes, updateWindow]);

  // Taille du guide changée (fenêtre redimensionnée, téléphone tourné)
  useEffect(() => {
    if (!bodyElement || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => {
      const rows = rowsRef.current;
      metrics.current = {
        rowPx: rowHeight(rows),
        pxPerMinute: remToPx(REM_PER_MINUTE),
      };
      updateWindow();
    });
    observer.observe(bodyElement);
    return () => observer.disconnect();
  }, [bodyElement, rowCount, updateWindow]);

  // Programmes sur le parcours de la télécommande : ceux de la timeline (pas ceux finis avant minuit),
  // une fois chacun (un programme à cheval sur minuit arrive avec chacun des deux jours chargés)
  const remoteRows = useMemo(() => (tv ? channels.map((ch) => {
    const epgId = ch.matched_epg_id || ch.epg_channel_id;
    const starts = new Set<number>();
    return ((epgId ? programs.get(epgId) : undefined) ?? []).filter((p) => {
      if (p.stopTs <= originTs || starts.has(p.startTs)) return false;
      starts.add(p.startTs);
      return true;
    });
  }) : []), [tv, channels, programs, originTs]);

  // Le corps arrive par `setBody` (rendu suivant) : la sélection reprise après un rechargement
  // passe ainsi après le défilement sur « maintenant » ci-dessous, qui ne la sort pas de l'écran
  useGuideTvRemote({
    body: bodyElement,
    enabled: tv,
    channels,
    rows: remoteRows,
    onChannelClick,
    revealCell,
    rendered: win,
  });

  // ── Auto-scroll au montage sur "maintenant" (plan §6 L193) ──────────
  useEffect(() => {
    if (isLoading || !bodyRef.current) {
      scrolledToNow.current = false;
      return;
    }

    const container = bodyRef.current;
    const nowOffset = (Date.now() / 1000 - originTs) / 60 * remToPx(REM_PER_MINUTE);
    cancelScroll(container);
    container.scrollLeft = nowOffset - container.clientWidth / 2;
    scrolledToNow.current = true;
    updateWindow();
  }, [isLoading, originTs, updateWindow]);

  // ── Sync scroll header ↔ body ───────────────────────────────────────
  const scrollFrame = useRef<number | null>(null);
  useEffect(() => () => {
    if (scrollFrame.current !== null) cancelAnimationFrame(scrollFrame.current);
    scrollFrame.current = null;
  }, []);
  const handleScroll = useCallback(() => {
    const body = bodyRef.current;
    const header = headerTimelineRef.current;
    if (!body || !header) return;

    // Sync horizontale header
    header.scrollLeft = body.scrollLeft;
    // Un seul recalcul de la fenêtre par image, même si plusieurs événements de défilement tombent
    // dans la même (filet : les navigateurs envoient déjà un événement par image ; le vrai levier
    // contre les images en retard est le pas de ROW_STEP rangées)
    if (scrollFrame.current === null) {
      scrollFrame.current = requestAnimationFrame(() => {
        scrollFrame.current = null;
        updateWindow();
      });
    }

    // ── Scroll boundary detection → lazy-load ─────────────────────────
    const scrollRight = body.scrollWidth - body.scrollLeft - body.clientWidth;
    const scrollLeft = body.scrollLeft;

    // Approche bord droit → charger jour suivant
    if (scrollRight < SCROLL_BOUNDARY_PX) {
      const maxLoadedDay = loadedDays.size > 0 ? Math.max(...loadedDays) : originTs;
      const nextDayTs = maxLoadedDay + SECONDS_PER_DAY;
      void loadDay(nextDayTs);
    }

    // Approche bord gauche → charger jour précédent
    if (scrollLeft < SCROLL_BOUNDARY_PX) {
      const minLoadedDay = loadedDays.size > 0 ? Math.min(...loadedDays) : originTs;
      const prevDayTs = minLoadedDay - SECONDS_PER_DAY;
      if (prevDayTs >= 0) {
        void loadDay(prevDayTs);
      }
    }
  }, [loadDay, loadedDays, originTs, updateWindow]);

  // ── Timestamps du now pour le highlight live ─────────────────────────
  // Relu au prochain début ou fin de programme (avant : figé à l'ouverture, le surlignage restait sur
  // l'ancien programme guide ouvert). Redessin seulement quand un programme change, au plus une fois
  // par minute (Chromecast : la grille entière se redessine).
  const [nowSec, setNowSec] = useState(() => Math.floor(Date.now() / 1000));
  useEffect(() => {
    const next = nextLiveChangeSec(programs, nowSec);
    if (next === null) return;
    const untilNext = next * 1000 - Date.now() + 50;
    const wait = Math.min(Math.max(untilNext, MIN_LIVE_WAIT_MS), MAX_LIVE_WAIT_MS);
    const timer = setTimeout(() => setNowSec(Math.floor(Date.now() / 1000)), wait);
    return () => clearTimeout(timer);
  }, [programs, nowSec]);
  // Retour au premier plan (appareil sorti de veille : les minuteurs n'ont pas compté ce temps)
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible') setNowSec(Math.floor(Date.now() / 1000));
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, []);

  // ── Hour labels ──────────────────────────────────────────────────────
  const hourLabels = useMemo(
    () => generateHourLabels(originTs, totalMinutes),
    [originTs, totalMinutes]
  );

  // ── Séparateurs de date ──────────────────────────────────────────────
  const dateSeparators = useMemo(() => {
    const separators: { ts: number; label: string; leftRem: number }[] = [];
    const totalSeconds = totalMinutes * 60;
    // Premier minuit APRÈS l'originTs
    let nextMidnight = originTs + SECONDS_PER_DAY;

    while (nextMidnight - originTs < totalSeconds) {
      separators.push({
        ts: nextMidnight,
        label: formatDateSeparator(nextMidnight),
        leftRem: ((nextMidnight - originTs) / 60) * REM_PER_MINUTE,
      });
      nextMidnight += SECONDS_PER_DAY;
    }

    return separators;
  }, [originTs, totalMinutes]);

  // ── Largeur totale de la timeline en rem ──────────────────────────────
  const timelineWidthRem = totalMinutes * REM_PER_MINUTE;

  // ── Chaînes dessinées (fenêtre bornée aux chaînes actuelles) ──────────
  const lastRow = Math.min(win.lastRow, rowCount - 1);
  const firstRow = Math.max(0, Math.min(win.firstRow, lastRow));
  const visibleChannels = lastRow >= firstRow ? channels.slice(firstRow, lastRow + 1) : [];

  // ── États spéciaux ───────────────────────────────────────────────────
  if (isLoading) {
    return <div className="guide-tv-grid__loading" data-testid="guide-loading">{t('guide_loading')}</div>;
  }

  if (error) {
    // Message traduit ; le détail technique reste dans le journal du hook
    return <div className="guide-tv-grid__error" data-testid="guide-error">{t('guide_load_error')}</div>;
  }

  return (
    <div className="guide-tv-grid" data-testid="guide-grid">
      {/* ── Header : coin vide + timeline horaire ── */}
      <div className="guide-tv-grid__header">
        <div className="guide-tv-grid__header-corner" />
        <div className="guide-tv-grid__header-timeline" ref={headerTimelineRef}>
          <div
            className="guide-tv-grid__hours"
            style={{ width: `${timelineWidthRem}rem` }}
          >
            {hourLabels.map((label, i) => (
              <div key={i} className="guide-tv-grid__hour-label">
                {label}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── Body : chaînes + programmes ── */}
      <div
        className="guide-tv-grid__body"
        data-testid="guide-body"
        data-nav-grid={tv ? '' : undefined}
        ref={setBody}
        onScroll={handleScroll}
      >
        <div className="guide-tv-grid__body-inner">
          {/* ── Colonne chaînes (sticky left) ── */}
          <div className="guide-tv-grid__channels">
            <RowsSpacer rows={firstRow} />
            {visibleChannels.map((ch, i) => (
              <GuideChannelCell
                key={ch.stream_id}
                row={firstRow + i}
                channel={ch}
                tv={tv}
                onChannelClick={onChannelClick}
              />
            ))}
            <RowsSpacer rows={rowCount - 1 - lastRow} />
          </div>

          {/* ── Rows programmes ── */}
          <div
            className="guide-tv-grid__rows"
            ref={rowsRef}
            style={{ width: `${timelineWidthRem}rem`, position: 'relative' }}
          >
            <RowsSpacer rows={firstRow} />
            {visibleChannels.map((ch, i) => {
              const epgId = ch.matched_epg_id || ch.epg_channel_id;
              return (
                <GuideRow
                  key={ch.stream_id}
                  row={firstRow + i}
                  channel={ch}
                  channelPrograms={epgId ? programs.get(epgId) : undefined}
                  originTs={originTs}
                  fromTs={win.fromTs}
                  toTs={win.toTs}
                  nowSec={nowSec}
                  tv={tv}
                />
              );
            })}
            <RowsSpacer rows={rowCount - 1 - lastRow} />

            {/* ── Séparateurs de date ── */}
            {dateSeparators.map(sep => (
              <div key={sep.ts}>
                <div
                  className="guide-tv-grid__date-separator"
                  style={{ left: `${sep.leftRem}rem` }}
                />
                <span
                  className="guide-tv-grid__date-label"
                  data-testid="guide-day"
                  style={{ left: `${sep.leftRem}rem` }}
                >
                  {sep.label}
                </span>
              </div>
            ))}

            {/* ── Marqueur de temps (Now) ── */}
            <CurrentTimeMarker
              originTs={originTs}
              remPerMinute={REM_PER_MINUTE}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
