-- ═══════════════════════════════════════════════════════════════════════════
-- LOS40 Historical Chart Database  ·  Schema v1.0
-- ═══════════════════════════════════════════════════════════════════════════
--
-- FUENTES DISPONIBLES EN EL HTML:
--
--  1. window.appData (script#app-data)  ← FUENTE PRINCIPAL, JSON limpio
--     globalContent[0..39]:
--       id                – UUID del entry (e.g. "fadbedfa9f9b844735141f214821a6d8")
--       date              – fecha del chart  ("2004-01-03T00:00:00+00:00")
--       position          – posición publicada (puede repetirse en algunas semanas)
--       lastPosition      – posición semana anterior (0 = no estaba)
--       twoWeeksPosition  – posición hace 2 semanas  (0 = no estaba)
--       bestPosition      – mejor posición histórica alcanzada
--       weeksInList       – semanas en lista
--       strongRise        – bool: subida notable
--       isGlobal          – bool: incluída en ranking internacional
--       songTitle         – título de la canción
--       albumTitle        – título del álbum
--       artistName        – artista(s) separados por ";"
--       coverImageUrl     – URL de la portada del single/álbum
--       altCoverImageUrl  – texto alt ("Carátula de: <album>")
--       youtubeUrl        – YouTube
--       itunesUrl         – preview iTunes (audio .m4a)
--       appleMusicId      – ID de Apple Music
--       spotifyUrl        – preview Spotify (30 seg .mp3)
--       mediaUrl          – audio directo en CDN de LOS40 (.mp4)
--       trackId           – ID interno LOS40 del track
--       artistId          – ID interno LOS40 del artista principal
--       trackArtistId     – ID completo artista del track
--       albumId           – ID interno LOS40 del álbum
--       albumYear         – año del álbum
--
--  2. HTML  <ul.lst-can>  ← solo para movimiento (sube/baja/nuevo/=)
--     <span class="sube|baja|nuevo">  (sin clase = igual/same)
--     Necesario porque para charts históricos lastPosition=0 en todos.
--
-- NOTAS HISTÓRICAS:
--   - Desde ≈1969-02-01: solo Nº1 (1 entrada por semana)
--   - Desde ≈2004: lista completa de 40 entradas
--   - La lista sale cada sábado (chart_date = el sábado de publicación)
-- ═══════════════════════════════════════════════════════════════════════════

PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;


-- ── ARTISTS ─────────────────────────────────────────────────────────────────
-- Un artista = una fila. Varios artistas por canción → track_artists.
-- "Britney Spears;Madonna" produce 2 filas con sort_order 1 y 2.

CREATE TABLE IF NOT EXISTS artists (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    name            TEXT    NOT NULL,
    los40_artist_id TEXT,           -- ID interno LOS40, e.g. "010000000160"
    UNIQUE (name)
);


-- ── ALBUMS ──────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS albums (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    los40_album_id  TEXT    NOT NULL UNIQUE,   -- e.g. "010000000132"
    title           TEXT,
    year            INTEGER,
    cover_url       TEXT    -- URL completa a la imagen de portada
);


-- ── TRACKS ──────────────────────────────────────────────────────────────────
-- Una fila por canción única. Re-entradas en semanas distintas usan la
-- misma fila de track, vinculada desde chart_entries.

CREATE TABLE IF NOT EXISTS tracks (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    los40_track_id      TEXT    NOT NULL UNIQUE,  -- e.g. "010000013381"
    title               TEXT    NOT NULL,
    album_id            INTEGER REFERENCES albums(id),
    youtube_url         TEXT,
    itunes_url          TEXT,                     -- preview iTunes (.m4a)
    apple_music_id      TEXT,
    spotify_preview_url TEXT,                     -- preview Spotify 30s (.mp3)
    media_url           TEXT                      -- audio directo CDN LOS40 (.mp4)
);


-- ── TRACK ↔ ARTIST  (muchos-a-muchos) ───────────────────────────────────────

CREATE TABLE IF NOT EXISTS track_artists (
    track_id    INTEGER NOT NULL REFERENCES tracks(id),
    artist_id   INTEGER NOT NULL REFERENCES artists(id),
    sort_order  INTEGER NOT NULL DEFAULT 1,   -- 1=principal, 2+=feat/colaboración
    PRIMARY KEY (track_id, artist_id)
);


-- ── CHARTS ───────────────────────────────────────────────────────────────────
-- Una fila por semana. chart_date = el sábado de publicación.

CREATE TABLE IF NOT EXISTS charts (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    chart_date   TEXT    NOT NULL UNIQUE,   -- ISO, e.g. "2004-01-03"
    url          TEXT,                      -- URL de origen
    entry_count  INTEGER DEFAULT 0,         -- 1 (histórico) o 40
    scraped_at   TEXT    DEFAULT (datetime('now'))
);


-- ── CHART ENTRIES ─────────────────────────────────────────────────────────────
-- Una fila por entrada del JSON. position puede repetirse en semanas concretas.

CREATE TABLE IF NOT EXISTS chart_entries (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    los40_entry_id      TEXT,                     -- UUID del JSON (puede repetirse entre semanas)
    chart_id            INTEGER NOT NULL REFERENCES charts(id),
    track_id            INTEGER NOT NULL REFERENCES tracks(id),
    position            INTEGER NOT NULL,
    last_position       INTEGER DEFAULT 0,        -- 0 = no estaba la semana anterior
    two_weeks_position  INTEGER DEFAULT 0,        -- 0 = no estaba hace 2 semanas
    best_position       INTEGER,                  -- mejor posición alcanzada alguna vez
    weeks_in_list       INTEGER DEFAULT 1,
    movement            TEXT    CHECK(movement IN ('new','up','down','same')),
    strong_rise         INTEGER DEFAULT 0,        -- bool: subida notable (strongRise)
    is_global           INTEGER DEFAULT 0,        -- bool: incluída en ranking global
    UNIQUE (chart_id, los40_entry_id)             -- el origen puede repetir position
);


-- ── SCRAPE LOG ────────────────────────────────────────────────────────────────
-- Registro de cada intento de scraping para resumibilidad y diagnóstico.

CREATE TABLE IF NOT EXISTS scrape_log (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    requested_date  TEXT    NOT NULL,
    actual_date     TEXT,    -- puede diferir (el server normaliza a sábado)
    status          TEXT    NOT NULL CHECK(status IN ('success','empty','error','skip')),
    message         TEXT,
    scraped_at      TEXT    DEFAULT (datetime('now'))
);


-- ── INDEXES ──────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_ce_chart      ON chart_entries(chart_id);
CREATE INDEX IF NOT EXISTS idx_ce_track      ON chart_entries(track_id);
CREATE INDEX IF NOT EXISTS idx_ce_position   ON chart_entries(position);
CREATE INDEX IF NOT EXISTS idx_ce_movement   ON chart_entries(movement);
CREATE INDEX IF NOT EXISTS idx_ta_track      ON track_artists(track_id);
CREATE INDEX IF NOT EXISTS idx_ta_artist     ON track_artists(artist_id);
CREATE INDEX IF NOT EXISTS idx_charts_date   ON charts(chart_date);
CREATE INDEX IF NOT EXISTS idx_artists_name  ON artists(name);
CREATE INDEX IF NOT EXISTS idx_tracks_title  ON tracks(title);


-- ── VIEWS ────────────────────────────────────────────────────────────────────

-- Vista principal desnormalizada: cómoda para consultas
CREATE VIEW IF NOT EXISTS v_chart AS
SELECT
    ce.id                            AS chart_entry_id,
    c.chart_date,
    ce.position,
    ce.movement,
    ce.weeks_in_list,
    ce.best_position,
    ce.last_position,
    ce.two_weeks_position,
    ce.strong_rise,
    ce.is_global,
    t.title                         AS song,
    GROUP_CONCAT(a.name, '; ')      AS artists,
    al.title                        AS album,
    al.year                         AS album_year,
    al.cover_url,
    t.youtube_url,
    t.spotify_preview_url,
    t.media_url,
    t.itunes_url,
    t.apple_music_id,
    t.los40_track_id,
    ce.los40_entry_id
FROM  chart_entries ce
JOIN  charts   c  ON ce.chart_id  = c.id
JOIN  tracks   t  ON ce.track_id  = t.id
LEFT JOIN albums   al ON t.album_id   = al.id
LEFT JOIN track_artists ta ON t.id    = ta.track_id
LEFT JOIN artists  a  ON ta.artist_id = a.id
GROUP BY ce.id
ORDER BY c.chart_date DESC, ce.position, ce.id;


-- Todos los números 1 con fecha y artista principal
CREATE VIEW IF NOT EXISTS v_number_ones AS
SELECT
    c.chart_date,
    a.name   AS artist,
    t.title  AS song,
    al.cover_url
FROM  chart_entries ce
JOIN  charts   c  ON ce.chart_id  = c.id
JOIN  tracks   t  ON ce.track_id  = t.id
LEFT JOIN albums   al ON t.album_id = al.id
JOIN  track_artists ta ON t.id = ta.track_id AND ta.sort_order = 1
JOIN  artists  a  ON ta.artist_id = a.id
WHERE ce.position = 1
ORDER BY c.chart_date;


-- ═══════════════════════════════════════════════════════════════════════════
-- CONSULTAS EJEMPLO
-- ═══════════════════════════════════════════════════════════════════════════

-- Historial completo de una canción:
-- SELECT chart_date, position, movement, weeks_in_list
-- FROM v_chart WHERE song = 'Tequila' ORDER BY chart_date;

-- Top 20 artistas por semanas en el Nº1:
-- SELECT artist, COUNT(*) AS semanas_en_1
-- FROM v_number_ones GROUP BY artist ORDER BY semanas_en_1 DESC LIMIT 20;

-- Canciones con más semanas en lista, con su mejor posición:
-- SELECT song, artists, MAX(weeks_in_list) AS semanas, MIN(best_position) AS pico
-- FROM v_chart GROUP BY los40_track_id ORDER BY semanas DESC LIMIT 20;

-- Todas las entradas de un artista específico:
-- SELECT chart_date, position, song, movement, weeks_in_list
-- FROM v_chart WHERE artists LIKE '%Alejandro Sanz%' ORDER BY chart_date;

-- Canciones nuevas de una semana:
-- SELECT position, song, artists FROM v_chart
-- WHERE chart_date = '2004-01-03' AND movement = 'new' ORDER BY position;

-- Evolución completa de la lista en 2004:
-- SELECT * FROM v_chart WHERE chart_date LIKE '2004-%' ORDER BY chart_date, position;

-- Cuántos números 1 tiene cada artista, con años:
-- SELECT artist,
--        COUNT(*) AS num_1s,
--        MIN(chart_date) AS primer_1,
--        MAX(chart_date) AS ultimo_1
-- FROM v_number_ones GROUP BY artist ORDER BY num_1s DESC;
