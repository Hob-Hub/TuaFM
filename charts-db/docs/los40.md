# LOS40 Historical Charts — Base de datos completa

Scraper + schema SQLite para recoger **todas las listas semanales de LOS40**
desde 1969 hasta hoy, con toda la metadata disponible.

---

## Instalación rápida

```bash
pip install requests beautifulsoup4 lxml
```

---

## Uso

```bash
# Test rápido: una sola semana
python sources/los40.py --date 2004-01-03

# Solo la era moderna (lista de 40 desde ~2004)
python sources/los40.py --start 2004-01-01

# Todo el histórico (desde 1969, solo nº1 hasta ~2004)
python sources/los40.py

# Un rango concreto
python sources/los40.py --start 2000-01-01 --end 2010-12-31

# Base de datos con nombre custom
python sources/los40.py --db mis_listas.db --delay 2.0
```

El scraper es **reanudable**: si lo interrumpes y lo relanzas, salta
automáticamente las semanas ya almacenadas (comprueba `charts.chart_date`).

---

## Lo que se extrae

### Fuente principal: `window.appData` (JSON embebido en cada página)

Está en el `<script id="app-data">` al final del HTML. Contiene un objeto
`globalContent` con una entrada por slot JSON (keys `"0"`, `"1"`, …`"39"`).
No hay que parsear el HTML estructural para los datos — el JSON es limpio
y fiable.

| Campo JSON          | Tabla/columna SQLite                   | Notas                                   |
|---------------------|----------------------------------------|-----------------------------------------|
| `id`                | `chart_entries.los40_entry_id`         | UUID de la entrada                      |
| `date`              | `charts.chart_date`                    | Fecha del chart (sábado)                |
| `position`          | `chart_entries.position`               | Posición publicada (puede repetirse)    |
| `lastPosition`      | `chart_entries.last_position`          | Posición semana anterior (0 = ausente)  |
| `twoWeeksPosition`  | `chart_entries.two_weeks_position`     | Posición hace 2 semanas                 |
| `bestPosition`      | `chart_entries.best_position`          | Mejor posición histórica alcanzada      |
| `weeksInList`       | `chart_entries.weeks_in_list`          | Semanas consecutivas en lista           |
| `strongRise`        | `chart_entries.strong_rise`            | Bool: subida notable                    |
| `isGlobal`          | `chart_entries.is_global`              | Bool: en ranking internacional          |
| `songTitle`         | `tracks.title`                         | Título de la canción                    |
| `albumTitle`        | `albums.title`                         | Título del álbum                        |
| `albumYear`         | `albums.year`                          | Año del álbum                           |
| `altCoverImageUrl`  | → `albums.title` (fallback)            | "Carátula de: <título>"                 |
| `artistName`        | `artists.name` (puede ser múltiple)    | Separado por ";" para colaboraciones    |
| `trackArtistId`     | `artists.los40_artist_id`              | ID interno del artista principal        |
| `coverImageUrl`     | `albums.cover_url`                     | URL imagen portada                      |
| `youtubeUrl`        | `tracks.youtube_url`                   | URL YouTube                             |
| `itunesUrl`         | `tracks.itunes_url`                    | Preview iTunes (.m4a, ~30s)             |
| `appleMusicId`      | `tracks.apple_music_id`                | ID Apple Music                          |
| `spotifyUrl`        | `tracks.spotify_preview_url`           | Preview Spotify (.mp3, 30s)             |
| `mediaUrl`          | `tracks.media_url`                     | Audio CDN LOS40 (.mp4)                  |
| `trackId`           | `tracks.los40_track_id`                | ID interno del track                    |
| `albumId`           | `albums.los40_album_id`                | ID interno del álbum                    |

### Fuente secundaria: clases HTML (`sube` / `baja` / `nuevo` / sin clase)

Para listas históricas donde `lastPosition = 0` (todos los registros anteriores
a cierta fecha), el `<span>` dentro de `.pos` tiene la clase del movimiento.
El scraper la usa como fallback para rellenar `chart_entries.movement`.

```html
<span class="sube">Sube</span>   → "up"
<span class="baja">Baja</span>   → "down"
<span class="nuevo">Nuevo</span> → "new"
<span>igual</span>               → "same"  (sin clase especial)
```

---

## Esquema de la base de datos

```
artists ────────────────────────────────────────────────────────────
  id  |  name            |  los40_artist_id
  ----+------------------+-----------------
   1  | Café Quijano     | 010000000160
   2  | Britney Spears   | 010000000033
   3  | Madonna          | NULL

albums ─────────────────────────────────────────────────────────────
  id  |  los40_album_id  |  title                      |  year  |  cover_url
  ----+------------------+-----------------------------+--------+-----------
   1  | 010000000132     | ¡Qué grande es esto del amor| 2004   | https://...

tracks ─────────────────────────────────────────────────────────────
  id  |  los40_track_id  |  title     |  album_id  |  youtube_url  | ...
  ----+------------------+------------+------------+---------------+---
   1  | 010000013381     | Tequila    |     1      | https://...   | ...

track_artists  (N:M) ────────────────────────────────────────────────
  track_id  |  artist_id  |  sort_order
  ----------+-------------+-----------
      5     |      2      |     1        ← Britney Spears (principal)
      5     |      3      |     2        ← Madonna (feat / colaboración)

charts ─────────────────────────────────────────────────────────────
  id  |  chart_date  |  entry_count  |  url
  ----+--------------+---------------+---------
   1  | 2004-01-03   |     40        | https://los40.com/lista40/...

chart_entries ──────────────────────────────────────────────────────
  id | chart_id | track_id | position | last_pos | weeks | movement | ...
  ---+----------+----------+----------+----------+-------+----------+---
   1 |    1     |    1     |    1     |    0     |   2   |  "down"  | ...
```

### Relaciones

```
charts 1──N chart_entries N──1 tracks N──M artists
                                        |
                                     albums
```

---

## Vistas disponibles

### `v_chart` — Vista desnormalizada completa

```sql
SELECT chart_date, position, movement, weeks_in_list,
       song, artists, album, cover_url, youtube_url
FROM v_chart
WHERE chart_date = '2004-01-03'
ORDER BY position;
```

### `v_number_ones` — Solo los números 1

```sql
SELECT chart_date, artist, song FROM v_number_ones
WHERE chart_date BETWEEN '2000-01-01' AND '2009-12-31';
```

---

## Consultas de ejemplo

```sql
-- Historial completo de una canción
SELECT chart_date, position, movement, weeks_in_list
FROM v_chart
WHERE song = 'Tequila'
ORDER BY chart_date;

-- Top artistas por semanas en el Nº1
SELECT artist, COUNT(*) AS semanas_en_1
FROM v_number_ones
GROUP BY artist
ORDER BY semanas_en_1 DESC
LIMIT 20;

-- Canciones con más semanas en lista
SELECT song, artists,
       MAX(weeks_in_list) AS semanas,
       MIN(best_position) AS pico
FROM v_chart
GROUP BY los40_track_id
ORDER BY semanas DESC
LIMIT 20;

-- Todas las entradas nuevas de una semana
SELECT position, song, artists
FROM v_chart
WHERE chart_date = '2004-01-03' AND movement = 'new'
ORDER BY position;

-- Evolución de Alejandro Sanz
SELECT chart_date, position, song, movement
FROM v_chart
WHERE artists LIKE '%Alejandro Sanz%'
ORDER BY chart_date;

-- Cuántos nº1 por artista, con primer y último año
SELECT artist,
       COUNT(*) AS num_1s,
       MIN(chart_date) AS primer_1,
       MAX(chart_date) AS ultimo_1
FROM v_number_ones
GROUP BY artist
ORDER BY num_1s DESC;

-- Qué había en el nº1 el día que nació alguien (ej. 15 sep 1990)
SELECT * FROM v_number_ones
WHERE chart_date <= '1990-09-15'
ORDER BY chart_date DESC
LIMIT 1;

-- Portadas disponibles de una época
SELECT DISTINCT cover_url, song, artists
FROM v_chart
WHERE chart_date LIKE '2003-%' AND cover_url IS NOT NULL
ORDER BY chart_date;

-- Canciones que vuelven a entrar (weeks_in_list=1 pero movement≠'new')
-- Esto puede indicar re-entradas o inconsistencias del dataset
SELECT chart_date, position, song, artists, last_position
FROM v_chart
WHERE weeks_in_list = 1 AND movement != 'new'
ORDER BY chart_date DESC;
```

---

## Notas históricas

| Período           | Entradas por semana | Observaciones                        |
|-------------------|---------------------|--------------------------------------|
| 1969-02 → ~2003   | 1                   | Solo el Nº1 está disponible          |
| ~2004 → hoy       | 40                  | Lista completa                       |

La lista sale **cada sábado**. El scraper itera de sábado en sábado.
Si una fecha no tiene datos (vacaciones, festivos), el servidor devuelve
la semana más próxima — el scraper registra la fecha real en `actual_date`
del `scrape_log` para no perder el dato.

---

## Estructura de ficheros

```
los40_scraper.py    ← scraper principal
schema/los40.sql    ← schema SQL independiente (para crear la BD a mano)
los40_queries.py    ← consultas y análisis desde línea de comandos
los40.db            ← base de datos generada (no incluida)
scraper.log         ← log de ejecución (generado en runtime)
```

---

## Rendimiento estimado

Con `--delay 1.5` (default):
- ~2.400 semanas de 2004 a 2026 ≈ ~1 hora
- ~1.800 semanas de 1969 a 2003 ≈ ~45 min (solo nº1, peticiones rápidas)

La BD resultante (2004–2026, ~96.000 entradas) ocupa en torno a **15-25 MB**.
