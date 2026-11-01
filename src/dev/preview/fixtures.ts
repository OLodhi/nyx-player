/**
 * fixtures.ts — Données factices du mode preview (DEV uniquement).
 * Catalogue Xtream + réponses TMDB cohérentes entre elles (mêmes tmdb_id).
 */

export { PREVIEW_USER_ID } from './bootstrap';
export const PREVIEW_PROFILE_ID = '00000000-0000-4000-8000-0000000000a1';
export const PREVIEW_CREDS = { host: 'http://preview.nyxplayer.local', username: 'preview', password: 'preview' };

const MOVIE_TITLES = [
  'Horizon Perdu', 'Les Ombres du Nord', 'Nuit Blanche à Lyon', 'Code Écarlate', 'Le Dernier Train',
  'Mémoire Vive', 'Opération Sirocco', 'La Cité des Brumes', 'Point de Rupture', 'Les Chemins de Sel',
  'Orbite Silencieuse', 'Le Pacte des Loups Gris', 'Dix Secondes', 'Rivages', 'L\'Héritier de Cendre',
  'Zone Rouge', 'Le Grand Saut', 'Contre-Courant', 'Les Veilleurs', 'Écho',
  'Fragments', 'Le Voyageur Immobile', 'Aube Glacée', 'Trajectoire', 'Les Âmes Sauvages',
  'Minuit Pile', 'Le Phare', 'Double Jeu', 'Nébuleuse', 'La Dernière Note',
  'Poussière d\'Étoiles', 'Le Témoin', 'Frontière', 'Cœurs Métalliques', 'Le Labyrinthe de Verre',
  'Tempête', 'Les Sentinelles', 'Hors Piste', 'Clair-Obscur', 'Le Signal',
];
const SERIES_TITLES = [
  'Les Gardiens du Delta', 'Station Arctique', 'Brigade Nocturne', 'Dynastie Moreau', 'Cyber Paris',
  'Les Enquêtes de Margaux', 'Terres Brûlées', 'Lycée Saint-Ex', 'Le Bureau des Fantômes', 'Odyssée 2140',
  'Faux Semblants', 'Marseille Connection', 'Les Héritiers', 'Signal Perdu', 'La Maison du Lac',
  'Protocole Zéro', 'Chroniques de Brume', 'Les Insoumis', 'Ligne 13', 'Big Data',
];
const LIVE_CHANNELS: Array<[string, string]> = [
  ['TF1', 'fr'], ['France 2', 'fr'], ['France 3', 'fr'], ['Canal+', 'fr'], ['France 5', 'fr'], ['M6', 'fr'],
  ['Arte', 'fr'], ['C8', 'fr'], ['W9', 'fr'], ['TMC', 'fr'], ['TFX', 'fr'], ['NRJ 12', 'fr'],
  ['BFM TV', 'info'], ['CNews', 'info'], ['LCI', 'info'], ['franceinfo', 'info'], ['Euronews', 'info'], ['France 24', 'info'],
  ['beIN Sports 1', 'sport'], ['beIN Sports 2', 'sport'], ['RMC Sport 1', 'sport'], ['Eurosport 1', 'sport'], ['L\'Équipe', 'sport'], ['Canal+ Sport', 'sport'],
  ['Ciné+ Premier', 'cine'], ['Ciné+ Frisson', 'cine'], ['OCS Max', 'cine'], ['TCM Cinéma', 'cine'], ['Paramount Channel', 'cine'], ['Action', 'cine'],
  ['Gulli', 'kids'], ['Canal J', 'kids'], ['Disney Channel', 'kids'], ['Boomerang', 'kids'], ['Tiji', 'kids'], ['Nickelodeon', 'kids'],
];

export const CATEGORIES = [
  { id: '10', name: 'Films | Action', type: 'movie' },
  { id: '11', name: 'Films | Comédie', type: 'movie' },
  { id: '12', name: 'Films | Science-fiction', type: 'movie' },
  { id: '13', name: 'Films | Drame', type: 'movie' },
  { id: '20', name: 'Séries | France', type: 'series' },
  { id: '21', name: 'Séries | US', type: 'series' },
  { id: '30', name: 'FR | Généralistes', type: 'live' },
  { id: '31', name: 'FR | Info', type: 'live' },
  { id: '32', name: 'FR | Sport', type: 'live' },
  { id: '33', name: 'FR | Cinéma', type: 'live' },
  { id: '34', name: 'FR | Jeunesse', type: 'live' },
];

const LIVE_CATEGORY: Record<string, string> = { fr: '30', info: '31', sport: '32', cine: '33', kids: '34' };

export const movieTmdbId = (i: number) => 1001 + i;
export const seriesTmdbId = (i: number) => 2001 + i;
/** 15 séries dans '20' (> 10 par rangée → carte "Voir tout" → CategoryDetailPage), 5 dans '21' */
const seriesCategory = (i: number) => (i % 4 === 3 ? '21' : '20');
const picsum = (seed: string, w: number, h: number) => `https://picsum.photos/seed/${seed}/${w}/${h}`;

export function catalogRows() {
  const now = Math.floor(Date.now() / 1000);
  const movies = MOVIE_TITLES.map((name, i) => ({
    id: 5000 + i,
    tmdb_id: movieTmdbId(i),
    name,
    icon: picsum(`nyx-poster-${movieTmdbId(i)}`, 300, 450),
    category_id: ['10', '11', '12', '13'][i % 4],
    added: now - i * 86400,
    rating: 5 + ((i * 7) % 50) / 10,
    container_extension: 'mp4',
    sort_order: i,
  }));
  // Versions multiples d'un même film (même tmdb_id) : sélecteur de source sur la page détail
  const extraVersions = [
    { of: 0, tag: '4K', ext: 'mkv' },
    { of: 0, tag: 'VOSTFR', ext: 'mkv' },
    { of: 1, tag: 'MULTI', ext: 'mkv' },
  ].map(({ of, tag, ext }, k) => ({
    ...movies[of],
    id: 5900 + k,
    name: `${MOVIE_TITLES[of]} [${tag}]`,
    container_extension: ext,
    sort_order: movies.length + k,
  }));
  movies.push(...extraVersions);

  const series = SERIES_TITLES.map((name, i) => ({
    id: 7000 + i,
    tmdb_id: seriesTmdbId(i),
    name,
    icon: picsum(`nyx-poster-${seriesTmdbId(i)}`, 300, 450),
    category_id: seriesCategory(i),
    added: now - i * 43200,
    rating: 6 + ((i * 3) % 40) / 10,
    sort_order: i,
  }));
  // Versions multiples d'une même série : sélecteur de source sur la page détail (comme les films)
  const extraSeriesVersions = [
    { of: 0, tag: 'VF' },
    { of: 0, tag: 'VOSTFR' },
  ].map(({ of, tag }, k) => ({
    ...series[of],
    id: 7900 + k,
    name: `${SERIES_TITLES[of]} [${tag}]`,
    sort_order: series.length + k,
  }));
  series.push(...extraSeriesVersions);

  const live = LIVE_CHANNELS.map(([name, group], i) => ({
    id: 9000 + i,
    name,
    icon: null as string | null,
    category_id: LIVE_CATEGORY[group],
    epg_channel_id: `ch${i}.fr`,
    matched_epg_id: `ch${i}.fr`,
    match_method: 'tvg_id',
    sort_order: i,
  }));
  return { movies, series, live };
}

export function epgRows() {
  const hour = 3600;
  const start = Math.floor(Date.now() / 1000 / hour) * hour - hour;
  const shows = ['Journal', 'Magazine', 'Film du soir', 'Documentaire', 'Série inédite', 'Direct', 'Talk-show'];
  const rows: Array<{ channel_id: string; title: string; start_ts: number; stop_ts: number; description: string }> = [];
  LIVE_CHANNELS.forEach((_, c) => {
    for (let slot = 0; slot < 6; slot++) {
      rows.push({
        channel_id: `ch${c}.fr`,
        title: `${shows[(c + slot) % shows.length]} ${slot + 1}`,
        start_ts: start + slot * hour,
        stop_ts: start + (slot + 1) * hour,
        description: 'Programme factice du mode preview.',
      });
    }
  });
  return rows;
}

// ---------------------------------------------------------------------------
// TMDB
// ---------------------------------------------------------------------------

const overview =
  'Un récit factice généré pour le mode preview de Nyx Player. Il permet de vérifier la mise en page des pages détail, des carrousels et du hero sur toutes les tailles d\'écran.';

export function tmdbMovie(i: number) {
  const id = movieTmdbId(i);
  return {
    id,
    title: MOVIE_TITLES[i],
    original_title: MOVIE_TITLES[i],
    overview,
    poster_path: `/nyx-poster-${id}.jpg`,
    backdrop_path: `/nyx-backdrop-${id}.jpg`,
    vote_average: 5 + ((i * 7) % 50) / 10,
    vote_count: 1200,
    release_date: `20${10 + (i % 15)}-0${1 + (i % 9)}-15`,
    genre_ids: [28, 12],
    popularity: 100 - i,
    media_type: 'movie',
    original_language: 'fr',
  };
}

export function tmdbTv(i: number) {
  const id = seriesTmdbId(i);
  return {
    id,
    name: SERIES_TITLES[i],
    original_name: SERIES_TITLES[i],
    overview,
    poster_path: `/nyx-poster-${id}.jpg`,
    backdrop_path: `/nyx-backdrop-${id}.jpg`,
    vote_average: 6 + ((i * 3) % 40) / 10,
    vote_count: 800,
    first_air_date: `20${12 + (i % 12)}-09-01`,
    genre_ids: [18, 80],
    popularity: 90 - i,
    media_type: 'tv',
    original_language: 'fr',
  };
}

const genres = [
  { id: 28, name: 'Action' },
  { id: 12, name: 'Aventure' },
  { id: 18, name: 'Drame' },
];

export function tmdbMovieDetails(id: number) {
  const i = Math.max(0, Math.min(MOVIE_TITLES.length - 1, id - 1001));
  const base = tmdbMovie(i);
  return {
    ...base,
    runtime: 118,
    genres,
    tagline: 'Rien ne sera plus comme avant.',
    status: 'Released',
    credits: {
      cast: Array.from({ length: 10 }, (_, k) => ({
        id: 300 + k, name: `Acteur ${k + 1}`, character: `Rôle ${k + 1}`, profile_path: `/nyx-person-${k}.jpg`, order: k,
      })),
      crew: [{ id: 99, name: 'Réalisatrice Preview', job: 'Director', department: 'Directing' }],
    },
    videos: { results: [] },
    images: { logos: [], backdrops: [], posters: [] },
    recommendations: { results: Array.from({ length: 10 }, (_, k) => tmdbMovie((i + k + 1) % MOVIE_TITLES.length)) },
    similar: { results: [] },
    release_dates: { results: [] },
  };
}

export function tmdbTvDetails(id: number) {
  const i = Math.max(0, Math.min(SERIES_TITLES.length - 1, id - 2001));
  const base = tmdbTv(i);
  return {
    ...base,
    number_of_seasons: 3,
    number_of_episodes: 30,
    episode_run_time: [45],
    genres,
    status: 'Returning Series',
    seasons: [1, 2, 3].map((s) => ({
      id: id * 10 + s, season_number: s, name: `Saison ${s}`, episode_count: 10, poster_path: `/nyx-poster-${id}-${s}.jpg`, air_date: '2020-01-01',
    })),
    credits: {
      cast: Array.from({ length: 8 }, (_, k) => ({
        id: 400 + k, name: `Acteur ${k + 1}`, character: `Rôle ${k + 1}`, profile_path: `/nyx-person-${k}.jpg`, order: k,
      })),
      crew: [],
    },
    videos: { results: [] },
    images: { logos: [], backdrops: [], posters: [] },
    recommendations: { results: Array.from({ length: 8 }, (_, k) => tmdbTv((i + k + 1) % SERIES_TITLES.length)) },
    content_ratings: { results: [] },
  };
}

export function tmdbSeason(tvId: number, season: number) {
  return {
    id: tvId * 10 + season,
    season_number: season,
    name: `Saison ${season}`,
    episodes: Array.from({ length: 10 }, (_, e) => ({
      id: tvId * 1000 + season * 100 + e,
      episode_number: e + 1,
      season_number: season,
      name: `Épisode ${e + 1}`,
      overview,
      still_path: `/nyx-still-${tvId}-${season}-${e}.jpg`,
      runtime: 45,
      air_date: '2020-01-01',
      vote_average: 7.5,
    })),
  };
}

export function xtreamSeriesInfo(seriesId: number) {
  const i = Math.max(0, seriesId - 7000);
  const seasons = [1, 2, 3];
  const episodes: Record<string, unknown[]> = {};
  seasons.forEach((s) => {
    episodes[String(s)] = Array.from({ length: 10 }, (_, e) => ({
      id: String(seriesId * 1000 + s * 100 + e),
      episode_num: e + 1,
      title: `${SERIES_TITLES[i] ?? 'Série'} - S${s}E${e + 1}`,
      container_extension: 'mkv',
      info: { duration_secs: 2700, movie_image: picsum(`nyx-still-${seriesId}-${s}-${e}`, 400, 225), plot: overview },
      season: s,
    }));
  });
  return {
    seasons: seasons.map((s) => ({ season_number: s, name: `Saison ${s}`, episode_count: 10 })),
    info: {
      name: SERIES_TITLES[i] ?? 'Série',
      cover: picsum(`nyx-poster-${seriesTmdbId(i)}`, 300, 450),
      plot: overview,
      tmdb: String(seriesTmdbId(i)),
      category_id: seriesCategory(i),
    },
    episodes,
  };
}
