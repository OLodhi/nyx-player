//! Historical journal of the SQLite schema, as the old `nyxplayer.db` database received it.
//! The app no longer applies it: each account database is created and upgraded by the page
//! (`src/services/dbCore.ts`) and by `schema.rs`. It stays as a picture of old databases,
//! which the tests below bring up to the current schema.

/// One step of the journal (same shape as the SQL plugin this journal was written for).
pub struct Migration {
    pub version: i64,
    pub description: &'static str,
    pub sql: &'static str,
    pub kind: MigrationKind,
}

/// Direction of a step: the journal only ever went forward.
pub enum MigrationKind {
    Up,
}

/// Returns the vector of SQLite migrations, in the order they were applied.
pub fn get_migrations() -> Vec<Migration> {
    vec![
        Migration {
            version: 1,
            description: "Create IPTV tables",
            sql: r#"
                -- Movies table
                CREATE TABLE IF NOT EXISTS movies (
                    id INTEGER PRIMARY KEY,
                    tmdb_id INTEGER,
                    name TEXT NOT NULL,
                    icon TEXT,
                    category_id TEXT,
                    added INTEGER,
                    rating REAL,
                    data TEXT
                );
                CREATE INDEX IF NOT EXISTS idx_movies_tmdb ON movies(tmdb_id);
                CREATE INDEX IF NOT EXISTS idx_movies_category ON movies(category_id);
                CREATE INDEX IF NOT EXISTS idx_movies_added ON movies(added);

                -- Series table
                CREATE TABLE IF NOT EXISTS series (
                    id INTEGER PRIMARY KEY,
                    tmdb_id INTEGER,
                    name TEXT NOT NULL,
                    icon TEXT,
                    category_id TEXT,
                    added INTEGER,
                    rating REAL,
                    data TEXT
                );
                CREATE INDEX IF NOT EXISTS idx_series_tmdb ON series(tmdb_id);
                CREATE INDEX IF NOT EXISTS idx_series_category ON series(category_id);

                -- Live streams table
                CREATE TABLE IF NOT EXISTS live (
                    id INTEGER PRIMARY KEY,
                    name TEXT NOT NULL,
                    icon TEXT,
                    category_id TEXT,
                    data TEXT
                );
                CREATE INDEX IF NOT EXISTS idx_live_category ON live(category_id);

                -- Categories table
                CREATE TABLE IF NOT EXISTS categories (
                    id TEXT PRIMARY KEY,
                    name TEXT NOT NULL,
                    type TEXT NOT NULL
                );

                -- Meta table for app settings
                CREATE TABLE IF NOT EXISTS meta (
                    key TEXT PRIMARY KEY,
                    value TEXT
                );
            "#,
            kind: MigrationKind::Up,
        },
        Migration {
            version: 2,
            description: "Create lightmaps cache table",
            sql: r#"
                -- LightMaps cache for fast app startup
                CREATE TABLE IF NOT EXISTS lightmaps_cache (
                    id INTEGER PRIMARY KEY,
                    data_hash TEXT NOT NULL,
                    created_at INTEGER NOT NULL,
                    data TEXT NOT NULL
                );
            "#,
            kind: MigrationKind::Up,
        },
        Migration {
            version: 3,
            description: "Create FTS5 search index",
            sql: r#"
                -- FTS5 virtual table for full-text search (replaces FlexSearch)
                -- Stores all content names for fast prefix/fuzzy search
                -- normalized_name: lowercase, no accents, no special chars
                CREATE VIRTUAL TABLE IF NOT EXISTS search_index USING fts5(
                    name,
                    normalized_name,
                    content_type,
                    content_id UNINDEXED
                );
            "#,
            kind: MigrationKind::Up,
        },
        Migration {
            version: 4,
            description: "Recreate FTS5 search index with normalized_name column",
            sql: r#"
                -- Drop and recreate to add normalized_name column
                DROP TABLE IF EXISTS search_index;
                CREATE VIRTUAL TABLE search_index USING fts5(
                    name,
                    normalized_name,
                    content_type,
                    content_id UNINDEXED
                );
            "#,
            kind: MigrationKind::Up,
        },
        Migration {
            version: 5,
            description: "Create playback progress table",
            sql: r#"
                -- Playback progress for Continue Watching carousel
                -- Stores playback positions with metadata for display
                CREATE TABLE IF NOT EXISTS playback_progress (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    
                    -- Identity
                    content_type TEXT NOT NULL CHECK(content_type IN ('movie', 'episode')),
                    stream_id INTEGER NOT NULL,
                    tmdb_id INTEGER DEFAULT 0,
                    
                    -- Display metadata (stored for performance, not fetched)
                    title TEXT NOT NULL,
                    poster_url TEXT,
                    
                    -- Series context (NULL for movies)
                    series_id INTEGER,
                    season_number INTEGER,
                    episode_number INTEGER,
                    
                    -- Smart Continue: next episode info
                    next_episode_id TEXT,
                    next_season INTEGER,
                    next_episode_number INTEGER,
                    
                    -- Progression
                    time_seconds REAL NOT NULL,
                    duration_seconds REAL NOT NULL,
                    
                    -- Timestamps
                    updated_at INTEGER NOT NULL,
                    
                    -- Unique per stream_id (replaces on save)
                    UNIQUE(stream_id)
                );
                
                -- Index for TMDB deduplication and filtering
                CREATE INDEX IF NOT EXISTS idx_playback_tmdb 
                    ON playback_progress(tmdb_id, content_type);
                    
                -- Index for sorting by most recent
                CREATE INDEX IF NOT EXISTS idx_playback_updated 
                    ON playback_progress(updated_at DESC);
            "#,
            kind: MigrationKind::Up,
        },
        Migration {
            version: 6,
            description: "Create watchlist table",
            sql: r#"
                -- Watchlist for Ma Liste feature
                -- Uses JOINs to get name/poster from movies/series tables
                CREATE TABLE IF NOT EXISTS watchlist (
                    stream_id INTEGER NOT NULL,
                    tmdb_id INTEGER DEFAULT 0,
                    type TEXT NOT NULL CHECK(type IN ('movie', 'series')),
                    added_at INTEGER NOT NULL,
                    PRIMARY KEY (stream_id, type)
                );
                
                -- Index for chronological display
                CREATE INDEX IF NOT EXISTS idx_watchlist_added 
                    ON watchlist(added_at DESC);
            "#,
            kind: MigrationKind::Up,
        },
        Migration {
            version: 7,
            description: "Create TMDB cache tables",
            sql: r#"
                -- Table 1: Cache des détails TMDB (films, séries, saisons)
                -- Colonnes uniformisées pour JOINs simples avec watchlist/playback_progress
                CREATE TABLE IF NOT EXISTS tmdb_details_cache (
                    tmdb_id INTEGER NOT NULL,
                    type TEXT NOT NULL CHECK(type IN ('movie', 'series', 'season')),
                    season_number INTEGER NOT NULL DEFAULT 0,
                    
                    -- Colonnes uniformisées (valeur calculée à l'insertion)
                    display_name TEXT,              -- title (movie) OU name (series)
                    display_date TEXT,              -- release_date (movie) OU first_air_date (series)
                    
                    -- Colonnes communes pour affichage
                    poster_path TEXT,
                    backdrop_path TEXT,
                    overview TEXT,
                    vote_average REAL,
                    number_of_seasons INTEGER,       -- Null pour movies
                    
                    -- JSON complet pour page détail (genres, cast, videos, backdrops[], etc.)
                    full_data TEXT NOT NULL,
                    
                    -- TTL management
                    cached_at INTEGER NOT NULL,
                    ttl_seconds INTEGER NOT NULL,
                    is_referenced INTEGER NOT NULL DEFAULT 0,
                    
                    PRIMARY KEY(tmdb_id, type, season_number)
                );
                
                -- Index covering pour JOINs watchlist/playback (évite lecture table)
                CREATE INDEX IF NOT EXISTS idx_tmdb_cache_display 
                    ON tmdb_details_cache(tmdb_id, type, display_name, poster_path);
                    
                -- Index pour cleanup des entrées expirées
                CREATE INDEX IF NOT EXISTS idx_tmdb_cache_cleanup 
                    ON tmdb_details_cache(cached_at, is_referenced);

                -- Table 2: Cache des listes (trending, now_playing, genres, etc.)
                -- Clés: 'trending', 'now_playing', 'top_rated', 'popular', 'on_the_air', 'genre_28', 'hero'
                CREATE TABLE IF NOT EXISTS cache_lists (
                    cache_key TEXT PRIMARY KEY,
                    data TEXT NOT NULL,
                    cached_at INTEGER NOT NULL,
                    ttl_seconds INTEGER NOT NULL
                );

                -- Table 3: Cache des séries Xtream (épisodes)
                -- Stocke les infos d'épisodes depuis l'API Xtream (pas TMDB)
                CREATE TABLE IF NOT EXISTS xtream_series_cache (
                    series_id INTEGER PRIMARY KEY,
                    data TEXT NOT NULL,
                    cached_at INTEGER NOT NULL,
                    ttl_seconds INTEGER NOT NULL
                );
            "#,
            kind: MigrationKind::Up,
        },
        Migration {
            version: 8,
            description: "Add container_extension to movies table",
            sql: r#"
                ALTER TABLE movies ADD COLUMN container_extension TEXT;
            "#,
            kind: MigrationKind::Up,
        },
        Migration {
            version: 9,
            description: "Add container_extension to playback_progress table",
            sql: r#"
                ALTER TABLE playback_progress ADD COLUMN container_extension TEXT;
            "#,
            kind: MigrationKind::Up,
        },
        Migration {
            version: 10,
            description: "Create user_preferences table (key/value store)",
            sql: r#"
                CREATE TABLE IF NOT EXISTS user_preferences (
                    key TEXT PRIMARY KEY NOT NULL,
                    value TEXT NOT NULL,
                    updated_at INTEGER NOT NULL DEFAULT (strftime('%s','now') * 1000)
                );
            "#,
            kind: MigrationKind::Up,
        },
        Migration {
            version: 11,
            description: "Create live_tv_favorites and live_tv_pinned_categories tables",
            sql: r#"
                CREATE TABLE IF NOT EXISTS live_tv_favorites (
                    stream_id INTEGER PRIMARY KEY,
                    added_at INTEGER NOT NULL DEFAULT (strftime('%s','now') * 1000)
                );

                CREATE TABLE IF NOT EXISTS live_tv_pinned_categories (
                    category_id TEXT PRIMARY KEY,
                    added_at INTEGER NOT NULL DEFAULT (strftime('%s','now') * 1000)
                );
            "#,
            kind: MigrationKind::Up,
        },
        Migration {
            version: 12,
            description: "Create content_preferences table",
            sql: r#"
                CREATE TABLE IF NOT EXISTS content_preferences (
                    content_type TEXT NOT NULL,
                    identifier TEXT NOT NULL,
                    key TEXT NOT NULL,
                    value TEXT NOT NULL,
                    updated_at INTEGER NOT NULL DEFAULT (strftime('%s','now') * 1000),
                    PRIMARY KEY (content_type, identifier, key)
                );
            "#,
            kind: MigrationKind::Up,
        },
        Migration {
            version: 13,
            description: "Add updated_at to watchlist for Supabase sync",
            sql: r#"
                ALTER TABLE watchlist ADD COLUMN updated_at INTEGER NOT NULL DEFAULT (strftime('%s','now') * 1000);
            "#,
            kind: MigrationKind::Up,
        },
        Migration {
            version: 14,
            description: "Add sort_order to catalog tables for stable provider ordering",
            sql: r#"
                ALTER TABLE movies ADD COLUMN sort_order INTEGER DEFAULT 0;
                ALTER TABLE series ADD COLUMN sort_order INTEGER DEFAULT 0;
                ALTER TABLE live ADD COLUMN sort_order INTEGER DEFAULT 0;
                ALTER TABLE categories ADD COLUMN sort_order INTEGER DEFAULT 0;
            "#,
            kind: MigrationKind::Up,
        },
        Migration {
            version: 15,
            description: "Create EPG programs table and add epg_channel_id to live",
            sql: r#"
                -- Table EPG : programmes TV (source XMLTV)
                CREATE TABLE IF NOT EXISTS epg_programs (
                    channel_id TEXT NOT NULL,
                    title TEXT NOT NULL,
                    start_ts INTEGER NOT NULL,
                    stop_ts INTEGER NOT NULL,
                    description TEXT,
                    PRIMARY KEY (channel_id, start_ts)
                );
                CREATE INDEX IF NOT EXISTS idx_epg_start ON epg_programs(start_ts);
                CREATE INDEX IF NOT EXISTS idx_epg_channel_start ON epg_programs(channel_id, start_ts);

                -- Lien provider → EPG sur la table live
                ALTER TABLE live ADD COLUMN epg_channel_id TEXT;
            "#,
            kind: MigrationKind::Up,
        },
    ]
}

#[cfg(test)]
#[path = "migrations_tests.rs"]
mod tests;
