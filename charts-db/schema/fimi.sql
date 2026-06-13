-- FIMI Year-End Singoli SQLite schema
-- Annual Italian singles chart data from FIMI Top of the Music.

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
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    chart_year    INTEGER NOT NULL UNIQUE,
    chart_date    TEXT    NOT NULL UNIQUE,
    source_title  TEXT,
    source_url    TEXT,
    source_period TEXT,
    entry_count   INTEGER DEFAULT 0,
    scraped_at    TEXT    DEFAULT (datetime('now'))
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

CREATE TABLE IF NOT EXISTS weekly_charts (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    chart_year   INTEGER NOT NULL,
    chart_week   INTEGER NOT NULL,
    chart_date   TEXT,
    source_url   TEXT,
    source_period TEXT,
    entry_count  INTEGER DEFAULT 0,
    scraped_at   TEXT DEFAULT (datetime('now')),
    UNIQUE (chart_year, chart_week)
);

CREATE TABLE IF NOT EXISTS weekly_entries (
    id                 INTEGER PRIMARY KEY AUTOINCREMENT,
    chart_id           INTEGER NOT NULL REFERENCES weekly_charts(id),
    track_id           INTEGER NOT NULL REFERENCES tracks(id),
    position           INTEGER NOT NULL,
    weeks_on_chart     INTEGER,
    source_title       TEXT NOT NULL,
    source_artist_text TEXT NOT NULL,
    source_artist_list TEXT NOT NULL,
    cover_url          TEXT,
    label              TEXT,
    distributor        TEXT,
    source_url         TEXT,
    UNIQUE (chart_id, track_id)
);

CREATE TABLE IF NOT EXISTS reconstructed_year_end_charts (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    chart_year       INTEGER NOT NULL UNIQUE,
    chart_date       TEXT    NOT NULL UNIQUE,
    source_title     TEXT,
    source_url       TEXT,
    source_period    TEXT,
    entry_count      INTEGER DEFAULT 0,
    weeks_count      INTEGER DEFAULT 0,
    max_weekly_depth INTEGER DEFAULT 0,
    method           TEXT,
    scraped_at       TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS reconstructed_year_end_entries (
    id                 INTEGER PRIMARY KEY AUTOINCREMENT,
    chart_id           INTEGER NOT NULL REFERENCES reconstructed_year_end_charts(id),
    track_id           INTEGER NOT NULL REFERENCES tracks(id),
    rank               INTEGER NOT NULL,
    score              REAL    NOT NULL,
    weeks_in_list      INTEGER NOT NULL,
    best_position      INTEGER NOT NULL,
    source_title       TEXT NOT NULL,
    source_artist_text TEXT NOT NULL,
    source_artist_list TEXT NOT NULL,
    cover_url          TEXT,
    label              TEXT,
    distributor        TEXT,
    source_url         TEXT,
    UNIQUE (chart_id, rank, track_id)
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
CREATE INDEX IF NOT EXISTS idx_wc_year_week      ON weekly_charts(chart_year, chart_week);
CREATE INDEX IF NOT EXISTS idx_we_chart          ON weekly_entries(chart_id);
CREATE INDEX IF NOT EXISTS idx_we_track          ON weekly_entries(track_id);
CREATE INDEX IF NOT EXISTS idx_we_position       ON weekly_entries(position);
CREATE INDEX IF NOT EXISTS idx_ryec_year         ON reconstructed_year_end_charts(chart_year);
CREATE INDEX IF NOT EXISTS idx_ryee_chart        ON reconstructed_year_end_entries(chart_id);
CREATE INDEX IF NOT EXISTS idx_ryee_track        ON reconstructed_year_end_entries(track_id);
CREATE INDEX IF NOT EXISTS idx_ryee_rank         ON reconstructed_year_end_entries(rank);

DROP VIEW IF EXISTS v_number_ones;
DROP VIEW IF EXISTS v_chart;
DROP VIEW IF EXISTS v_chart_all_sources;
DROP VIEW IF EXISTS v_chart_reconstructed;
DROP VIEW IF EXISTS v_chart_official;

CREATE VIEW v_chart_official AS
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
    ye.cover_url,
    NULL                    AS youtube_url,
    NULL                    AS spotify_preview_url,
    NULL                    AS media_url,
    NULL                    AS itunes_url,
    NULL                    AS apple_music_id,
    t.id                    AS fimi_track_id,
    ye.id                   AS fimi_entry_id,
    'fimi_annual_official'  AS chart_source,
    yc.entry_count          AS year_entry_count,
    yc.source_period,
    NULL                    AS reconstruction_method,
    NULL                    AS weekly_score
FROM year_end_entries ye
JOIN year_end_charts yc ON ye.chart_id = yc.id
JOIN tracks t ON ye.track_id = t.id
ORDER BY yc.chart_year, ye.rank, ye.id;

CREATE VIEW v_chart_reconstructed AS
SELECT
    -rye.id                         AS chart_entry_id,
    ryc.chart_year,
    ryc.chart_date,
    rye.rank                        AS position,
    NULL                            AS movement,
    rye.weeks_in_list,
    rye.best_position,
    t.title                         AS song,
    rye.source_artist_list          AS artists,
    rye.source_artist_text          AS source_artist_text,
    rye.label,
    rye.distributor,
    rye.source_url,
    rye.cover_url,
    NULL                            AS youtube_url,
    NULL                            AS spotify_preview_url,
    NULL                            AS media_url,
    NULL                            AS itunes_url,
    NULL                            AS apple_music_id,
    t.id                            AS fimi_track_id,
    -rye.id                         AS fimi_entry_id,
    'fimi_weekly_reconstructed'     AS chart_source,
    ryc.entry_count                 AS year_entry_count,
    ryc.source_period,
    ryc.method                      AS reconstruction_method,
    rye.score                       AS weekly_score
FROM reconstructed_year_end_entries rye
JOIN reconstructed_year_end_charts ryc ON rye.chart_id = ryc.id
JOIN tracks t ON rye.track_id = t.id
ORDER BY ryc.chart_year, rye.rank, rye.id;

CREATE VIEW v_chart_all_sources AS
SELECT * FROM v_chart_official
UNION ALL
SELECT * FROM v_chart_reconstructed;

CREATE VIEW v_chart AS
WITH years AS (
    SELECT chart_year FROM year_end_charts
    UNION
    SELECT chart_year FROM reconstructed_year_end_charts
),
best_source AS (
    SELECT
        years.chart_year,
        CASE
            WHEN yc.id IS NULL THEN 'fimi_weekly_reconstructed'
            WHEN ryc.id IS NOT NULL AND ryc.entry_count > yc.entry_count THEN 'fimi_weekly_reconstructed'
            ELSE 'fimi_annual_official'
        END AS chart_source
    FROM years
    LEFT JOIN year_end_charts yc ON yc.chart_year = years.chart_year
    LEFT JOIN reconstructed_year_end_charts ryc ON ryc.chart_year = years.chart_year
)
SELECT src.*
FROM v_chart_all_sources src
JOIN best_source best
  ON best.chart_year = src.chart_year
 AND best.chart_source = src.chart_source
ORDER BY src.chart_year, src.position, src.chart_entry_id;

CREATE VIEW v_number_ones AS
SELECT
    chart_year,
    chart_date,
    artists AS artist,
    song,
    source_url,
    cover_url,
    chart_source
FROM v_chart
WHERE position = 1
ORDER BY chart_year;
