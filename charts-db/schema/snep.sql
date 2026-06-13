-- SNEP Year-End Top Singles SQLite schema
-- Annual French singles chart data from SNEP / SCPP.

PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS artists (
    id       INTEGER PRIMARY KEY AUTOINCREMENT,
    name     TEXT NOT NULL,
    name_key TEXT NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS tracks (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    title      TEXT NOT NULL,
    title_key  TEXT NOT NULL,
    artist_key TEXT NOT NULL,
    UNIQUE (title_key, artist_key)
);

CREATE TABLE IF NOT EXISTS track_artists (
    track_id   INTEGER NOT NULL REFERENCES tracks(id),
    artist_id  INTEGER NOT NULL REFERENCES artists(id),
    sort_order INTEGER NOT NULL DEFAULT 1,
    PRIMARY KEY (track_id, artist_id)
);

CREATE TABLE IF NOT EXISTS year_end_charts (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    chart_year     INTEGER NOT NULL UNIQUE,
    chart_date     TEXT    NOT NULL UNIQUE,
    source_title   TEXT,
    source_url     TEXT,
    source_pdf_url TEXT,
    source_period  TEXT,
    entry_count    INTEGER DEFAULT 0,
    scraped_at     TEXT    DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS year_end_entries (
    id                 INTEGER PRIMARY KEY AUTOINCREMENT,
    chart_id           INTEGER NOT NULL REFERENCES year_end_charts(id),
    track_id           INTEGER NOT NULL REFERENCES tracks(id),
    rank               INTEGER NOT NULL,
    source_title       TEXT NOT NULL,
    source_artist_text TEXT NOT NULL,
    source_artist_list TEXT NOT NULL,
    cover_url          TEXT,
    label              TEXT,
    distributor        TEXT,
    spotify_url        TEXT,
    deezer_url         TEXT,
    itunes_url         TEXT,
    qobuz_url          TEXT,
    amazon_url         TEXT,
    fnac_url           TEXT,
    source_url         TEXT,
    UNIQUE (chart_id, rank, track_id)
);

CREATE TABLE IF NOT EXISTS scrape_log (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    chart_year  INTEGER NOT NULL,
    status      TEXT    NOT NULL CHECK(status IN ('success','empty','error','skip')),
    message     TEXT,
    scraped_at  TEXT    DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_tracks_title_key  ON tracks(title_key);
CREATE INDEX IF NOT EXISTS idx_tracks_artist_key ON tracks(artist_key);
CREATE INDEX IF NOT EXISTS idx_artists_name_key  ON artists(name_key);
CREATE INDEX IF NOT EXISTS idx_ta_track          ON track_artists(track_id);
CREATE INDEX IF NOT EXISTS idx_ta_artist         ON track_artists(artist_id);
CREATE INDEX IF NOT EXISTS idx_yec_year          ON year_end_charts(chart_year);
CREATE INDEX IF NOT EXISTS idx_yee_chart         ON year_end_entries(chart_id);
CREATE INDEX IF NOT EXISTS idx_yee_track         ON year_end_entries(track_id);
CREATE INDEX IF NOT EXISTS idx_yee_rank          ON year_end_entries(rank);

DROP VIEW IF EXISTS v_number_ones;
DROP VIEW IF EXISTS v_chart;

CREATE VIEW v_chart AS
SELECT
    ye.id                   AS chart_entry_id,
    yc.chart_year,
    yc.chart_date,
    ye.rank                 AS position,
    NULL                    AS movement,
    1                       AS weeks_in_list,
    ye.rank                 AS best_position,
    t.title                 AS song,
    ye.source_artist_list   AS artists,
    ye.source_artist_text   AS source_artist_text,
    ye.label,
    ye.distributor,
    ye.source_url,
    yc.source_pdf_url,
    ye.cover_url,
    NULL                    AS youtube_url,
    ye.spotify_url          AS spotify_url,
    ye.deezer_url,
    ye.itunes_url,
    ye.qobuz_url,
    ye.amazon_url,
    ye.fnac_url,
    NULL                    AS spotify_preview_url,
    NULL                    AS media_url,
    NULL                    AS apple_music_id,
    t.id                    AS snep_track_id,
    ye.id                   AS snep_entry_id,
    'snep_annual_official'  AS chart_source,
    yc.entry_count          AS year_entry_count,
    yc.source_period
FROM year_end_entries ye
JOIN year_end_charts yc ON ye.chart_id = yc.id
JOIN tracks t ON ye.track_id = t.id
ORDER BY yc.chart_year, ye.rank, ye.id;

CREATE VIEW v_number_ones AS
SELECT
    chart_year,
    chart_date,
    artists AS artist,
    song,
    source_url,
    source_pdf_url,
    cover_url
FROM v_chart
WHERE position = 1
ORDER BY chart_year;
