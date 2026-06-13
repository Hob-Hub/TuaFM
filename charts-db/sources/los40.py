#!/usr/bin/env python3
"""
LOS40 Historical Chart Scraper
═══════════════════════════════════════════════════════════════════════
Recoge todas las listas semanales de LOS40 desde 1969 en una SQLite.

Fuente principal: JSON window.appData embebido en cada página.
Fuente secundaria: HTML (clases span .sube/.baja/.nuevo) para movimiento
                   en charts históricos donde lastPosition=0.

Instalación:
    pip install requests beautifulsoup4 lxml

Uso:
    python los40_scraper.py                         # todo desde 1969
    python los40_scraper.py --start 2004-01-01      # desde un año concreto
    python los40_scraper.py --end   2010-12-31      # hasta una fecha
    python los40_scraper.py --date  2004-01-03      # una sola semana (test)
    python los40_scraper.py --delay 2.0             # más lento (cortés)
    python los40_scraper.py --db mi_coleccion.db    # base de datos custom
"""

import sqlite3
import json
import re
import time
import sys
import argparse
from html import unescape
from datetime import date, timedelta, datetime
from typing import Dict, List, Optional, Tuple
from pathlib import Path

import requests
from bs4 import BeautifulSoup

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from lib.common import build_session, configure_output_encoding, setup_logging


configure_output_encoding()

# ─── CONFIGURACIÓN ────────────────────────────────────────────────────────────

DB_PATH       = "los40.db"
BASE_URL      = "https://los40.com/lista40/listas-anteriores/{date}/"
START_DATE    = date(1969, 2, 1)   # primera lista según data-min-date del HTML
REQUEST_DELAY = 1.5                # segundos entre peticiones (sé respetuoso)
USER_AGENT    = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/120.0.0.0 Safari/537.36"
)
ACCEPT_LANGUAGE = "es-ES,es;q=0.9"

log = setup_logging("los40.log", __name__)


# ─── SCHEMA SQL ───────────────────────────────────────────────────────────────

SCHEMA = """
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS artists (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    name            TEXT    NOT NULL,
    los40_artist_id TEXT,
    UNIQUE (name)
);

CREATE TABLE IF NOT EXISTS albums (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    los40_album_id  TEXT    NOT NULL UNIQUE,
    title           TEXT,
    year            INTEGER,
    cover_url       TEXT
);

CREATE TABLE IF NOT EXISTS tracks (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    los40_track_id      TEXT    NOT NULL UNIQUE,
    title               TEXT    NOT NULL,
    album_id            INTEGER REFERENCES albums(id),
    youtube_url         TEXT,
    itunes_url          TEXT,
    apple_music_id      TEXT,
    spotify_preview_url TEXT,
    media_url           TEXT
);

CREATE TABLE IF NOT EXISTS track_artists (
    track_id    INTEGER NOT NULL REFERENCES tracks(id),
    artist_id   INTEGER NOT NULL REFERENCES artists(id),
    sort_order  INTEGER NOT NULL DEFAULT 1,
    PRIMARY KEY (track_id, artist_id)
);

CREATE TABLE IF NOT EXISTS charts (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    chart_date   TEXT    NOT NULL UNIQUE,
    url          TEXT,
    entry_count  INTEGER DEFAULT 0,
    scraped_at   TEXT    DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS chart_entries (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    los40_entry_id      TEXT,
    chart_id            INTEGER NOT NULL REFERENCES charts(id),
    track_id            INTEGER NOT NULL REFERENCES tracks(id),
    position            INTEGER NOT NULL,
    last_position       INTEGER DEFAULT 0,
    two_weeks_position  INTEGER DEFAULT 0,
    best_position       INTEGER,
    weeks_in_list       INTEGER DEFAULT 1,
    movement            TEXT    CHECK(movement IN ('new','up','down','same')),
    strong_rise         INTEGER DEFAULT 0,
    is_global           INTEGER DEFAULT 0,
    UNIQUE (chart_id, los40_entry_id)
);

CREATE TABLE IF NOT EXISTS scrape_log (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    requested_date  TEXT    NOT NULL,
    actual_date     TEXT,
    status          TEXT    NOT NULL CHECK(status IN ('success','empty','error','skip')),
    message         TEXT,
    scraped_at      TEXT    DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_ce_chart      ON chart_entries(chart_id);
CREATE INDEX IF NOT EXISTS idx_ce_track      ON chart_entries(track_id);
CREATE INDEX IF NOT EXISTS idx_ce_position   ON chart_entries(position);
CREATE INDEX IF NOT EXISTS idx_ce_movement   ON chart_entries(movement);
CREATE INDEX IF NOT EXISTS idx_ta_track      ON track_artists(track_id);
CREATE INDEX IF NOT EXISTS idx_ta_artist     ON track_artists(artist_id);
CREATE INDEX IF NOT EXISTS idx_charts_date   ON charts(chart_date);
CREATE INDEX IF NOT EXISTS idx_artists_name  ON artists(name);
CREATE INDEX IF NOT EXISTS idx_tracks_title  ON tracks(title);

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
"""


# ─── BASE DE DATOS ────────────────────────────────────────────────────────────

class DB:
    """Wrapper SQLite con todos los upserts necesarios."""

    def __init__(self, path: str):
        self.con = sqlite3.connect(path, check_same_thread=False)
        self.con.row_factory = sqlite3.Row
        self.con.executescript(SCHEMA)
        self.con.commit()
        log.info(f"Base de datos: {Path(path).absolute()}")

    # ── consultas ────────────────────────────────────────────────────────────

    def chart_exists(self, chart_date: str) -> bool:
        return self.con.execute(
            "SELECT 1 FROM charts WHERE chart_date = ?", (chart_date,)
        ).fetchone() is not None

    def last_scraped_date(self) -> Optional[str]:
        row = self.con.execute(
            "SELECT MAX(chart_date) AS d FROM charts"
        ).fetchone()
        return row["d"] if row else None

    # ── upserts ──────────────────────────────────────────────────────────────

    def upsert_artist(self, name: str, los40_id: Optional[str] = None) -> int:
        """Inserta o actualiza artista; devuelve su id interno."""
        self.con.execute(
            """INSERT INTO artists (name, los40_artist_id) VALUES (?, ?)
               ON CONFLICT(name) DO UPDATE SET
               los40_artist_id = COALESCE(excluded.los40_artist_id, los40_artist_id)""",
            (name, los40_id or None),
        )
        return self.con.execute(
            "SELECT id FROM artists WHERE name = ?", (name,)
        ).fetchone()["id"]

    def upsert_album(self, los40_album_id: str, title: Optional[str],
                     year: Optional[int], cover_url: Optional[str]) -> int:
        self.con.execute(
            """INSERT INTO albums (los40_album_id, title, year, cover_url)
               VALUES (?, ?, ?, ?)
               ON CONFLICT(los40_album_id) DO UPDATE SET
               title     = COALESCE(excluded.title,     title),
               year      = COALESCE(excluded.year,      year),
               cover_url = COALESCE(excluded.cover_url, cover_url)""",
            (los40_album_id, title or None, year, cover_url or None),
        )
        return self.con.execute(
            "SELECT id FROM albums WHERE los40_album_id = ?", (los40_album_id,)
        ).fetchone()["id"]

    def upsert_track(self, los40_track_id: str, title: str,
                     album_id: Optional[int], youtube_url: Optional[str],
                     itunes_url: Optional[str], apple_music_id: Optional[str],
                     spotify_preview_url: Optional[str],
                     media_url: Optional[str]) -> int:
        self.con.execute(
            """INSERT INTO tracks
               (los40_track_id, title, album_id, youtube_url, itunes_url,
                apple_music_id, spotify_preview_url, media_url)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?)
               ON CONFLICT(los40_track_id) DO UPDATE SET
               youtube_url         = COALESCE(excluded.youtube_url,         youtube_url),
               itunes_url          = COALESCE(excluded.itunes_url,          itunes_url),
               apple_music_id      = COALESCE(excluded.apple_music_id,      apple_music_id),
               spotify_preview_url = COALESCE(excluded.spotify_preview_url, spotify_preview_url),
               media_url           = COALESCE(excluded.media_url,           media_url)""",
            (los40_track_id, title, album_id, youtube_url, itunes_url,
             apple_music_id, spotify_preview_url, media_url),
        )
        return self.con.execute(
            "SELECT id FROM tracks WHERE los40_track_id = ?", (los40_track_id,)
        ).fetchone()["id"]

    def link_artist(self, track_id: int, artist_id: int, order: int):
        self.con.execute(
            "INSERT OR IGNORE INTO track_artists (track_id, artist_id, sort_order)"
            " VALUES (?, ?, ?)",
            (track_id, artist_id, order),
        )

    def insert_chart(self, chart_date: str, url: str, count: int) -> int:
        self.con.execute(
            "INSERT OR IGNORE INTO charts (chart_date, url, entry_count) VALUES (?, ?, ?)",
            (chart_date, url, count),
        )
        return self.con.execute(
            "SELECT id FROM charts WHERE chart_date = ?", (chart_date,)
        ).fetchone()["id"]

    def insert_entry(self, los40_entry_id: Optional[str], chart_id: int,
                     track_id: int, position: int, last_position: int,
                     two_weeks_position: int, best_position: Optional[int],
                     weeks_in_list: int, movement: str,
                     strong_rise: bool, is_global: bool):
        self.con.execute(
            """INSERT OR IGNORE INTO chart_entries
               (los40_entry_id, chart_id, track_id, position, last_position,
                two_weeks_position, best_position, weeks_in_list, movement,
                strong_rise, is_global)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (los40_entry_id or None, chart_id, track_id, position, last_position,
             two_weeks_position, best_position, weeks_in_list, movement,
             1 if strong_rise else 0, 1 if is_global else 0),
        )

    def log_scrape(self, requested: str, actual: Optional[str],
                   status: str, msg: str = ""):
        self.con.execute(
            "INSERT INTO scrape_log (requested_date, actual_date, status, message)"
            " VALUES (?, ?, ?, ?)",
            (requested, actual, status, msg),
        )

    def commit(self):
        self.con.commit()

    def close(self):
        self.con.close()


# ─── PARSING ──────────────────────────────────────────────────────────────────

# Regex para extraer el JSON de window.appData
_APP_DATA_RE = re.compile(
    r'<script[^>]+id=["\']app-data["\'][^>]*>\s*window\.appData\s*=\s*(\{.+\})\s*</script>',
    re.DOTALL,
)


def extract_app_data(html: str) -> Optional[dict]:
    """Extrae el JSON window.appData del HTML."""
    m = _APP_DATA_RE.search(html)
    if not m:
        return None
    try:
        return json.loads(m.group(1))
    except json.JSONDecodeError as exc:
        log.error(f"JSON parse error: {exc}")
        return None


def extract_movements_from_html(html: str) -> Dict[str, str]:
    """
    Extrae movimiento (new/up/down/same) de las clases HTML de cada entry.

    Necesario para charts históricos donde appData.lastPosition = 0
    aunque la canción lleve semanas en lista.

    Estructura HTML:
        <li id="UUID">
          <div class="pos">
            <p>3</p>
            <span class="baja">Baja</span>   ← o "sube", "nuevo", sin clase
          </div>
        </li>
    """
    soup = BeautifulSoup(html, "lxml")
    result: Dict[str, str] = {}

    for li in soup.select("ul.lst-can > li[id]"):
        entry_id = li.get("id", "")
        if not entry_id:
            continue
        span = li.select_one(".pos > span")
        if not span:
            result[entry_id] = "new"
            continue
        classes = set(span.get("class", []))
        if "nuevo" in classes:
            result[entry_id] = "new"
        elif "sube" in classes:
            result[entry_id] = "up"
        elif "baja" in classes:
            result[entry_id] = "down"
        else:
            result[entry_id] = "same"    # <span> sin clase especial = igual

    return result


def parse_artists(raw: str, main_id: str) -> List[Tuple[str, Optional[str]]]:
    """
    Convierte "Britney Spears;Madonna" en [(name, los40_id), ...].
    El ID solo se asigna al artista principal (sort_order=1).
    """
    names = [n.strip() for n in raw.split(";") if n.strip()]
    return [
        (name, main_id if i == 0 and main_id else None)
        for i, name in enumerate(names)
    ]


def determine_movement(position: int, last_position: int,
                       weeks_in_list: int,
                       html_movement: Optional[str]) -> str:
    """
    Lógica de movimiento:
      - Si lastPosition > 0  → calculamos directamente
      - Si lastPosition == 0 y weeks == 1  → nueva entrada
      - Si lastPosition == 0 y weeks > 1   → chart histórico sin tracking;
        usamos el span HTML como fallback
    """
    if last_position > 0:
        if position < last_position:
            return "up"
        elif position > last_position:
            return "down"
        else:
            return "same"

    if weeks_in_list == 1:
        return "new"

    # Histórico sin lastPosition: confiamos en el HTML
    return html_movement if html_movement else "same"


def clean(value) -> Optional[str]:
    """Convierte vacío/"" a None; útil para las URLs opcionales."""
    if not value:
        return None
    s = str(value).strip()
    return unescape(s) if s else None


def clean_text(value) -> str:
    return clean(value) or ""


def next_saturday(d: date) -> date:
    """Devuelve el sabado indicado o el siguiente si la fecha cae otro dia."""
    return d + timedelta(days=(5 - d.weekday()) % 7)


# ─── PROCESAMIENTO DE PÁGINA ──────────────────────────────────────────────────

def process_page(html: str, requested_date: str, url: str, db: DB):
    """
    Parsea la página y almacena el chart completo en la BD.
    Extrae datos de appData (JSON) + movimiento del HTML.
    """
    app_data = extract_app_data(html)
    if not app_data:
        log.warning(f"Sin appData en {url}")
        db.log_scrape(requested_date, None, "empty", "no appData")
        db.commit()
        return

    global_content = app_data.get("globalContent", {})
    # Las entradas del chart están bajo keys "0", "1", "2", ...
    raw_entries: List[dict] = [
        v for k, v in global_content.items()
        if isinstance(k, str) and k.isdigit() and isinstance(v, dict)
    ]

    if not raw_entries:
        log.warning(f"Chart vacío en {url}")
        db.log_scrape(requested_date, None, "empty", "globalContent sin entries")
        db.commit()
        return

    # Algunas semanas publican posiciones repetidas; el sort estable conserva
    # el orden original de appData dentro de cada posicion.
    raw_entries.sort(key=lambda x: x.get("position", 999))

    # Fecha real del chart (el servidor puede devolver la semana adyacente)
    actual_date = requested_date
    raw_date = raw_entries[0].get("date", "")
    if raw_date:
        actual_date = raw_date[:10]   # "2004-01-03T00:00:00+00:00" → "2004-01-03"

    # Movimientos desde HTML
    html_movements = extract_movements_from_html(html)

    # Insertar chart
    chart_id = db.insert_chart(actual_date, url, len(raw_entries))

    ok = err = 0
    for entry in raw_entries:
        try:
            _store_entry(entry, chart_id, html_movements, db)
            ok += 1
        except Exception as exc:
            pos = entry.get("position", "?")
            log.error(f"  Error entry pos={pos} chart={actual_date}: {exc}", exc_info=True)
            err += 1

    db.log_scrape(requested_date, actual_date, "success",
                  f"{ok} entradas, {err} errores")
    db.commit()
    log.info(f"  ✓  {actual_date}  ·  {ok} entradas {'⚠ '+str(err)+' errores' if err else ''}")


def _store_entry(entry: dict, chart_id: int,
                 html_movements: Dict[str, str], db: DB):
    """Almacena una sola entrada del chart (track + artistas + entry)."""

    entry_id    = (entry.get("id") or "").strip()
    track_id_s  = (entry.get("trackId") or "").strip()
    track_title = clean_text(entry.get("songTitle"))
    artist_raw  = clean_text(entry.get("artistName"))

    if not track_title:
        raise ValueError("songTitle vacío")

    # Si no hay trackId (rarísimo en datos muy antiguos), generamos uno estable
    if not track_id_s:
        track_id_s = f"__NOID__{track_title[:40]}_{artist_raw[:20]}".replace(" ", "_")

    # ── Album ────────────────────────────────────────────────────────────────
    album_id   = None
    alb_id_s   = (entry.get("albumId") or "").strip()

    if alb_id_s:
        # albumTitle viene explícito en el JSON; altCoverImageUrl es el alt-text
        alb_title = clean_text(entry.get("albumTitle"))
        if not alb_title:
            alt = clean_text(entry.get("altCoverImageUrl"))
            if alt.startswith("Carátula de: "):
                alb_title = alt[len("Carátula de: "):]

        yr_s     = (entry.get("albumYear") or "").strip()
        alb_year = int(yr_s) if yr_s.isdigit() else None
        cover    = clean(entry.get("coverImageUrl"))
        album_id = db.upsert_album(alb_id_s, alb_title or None, alb_year, cover)

    # ── Track ────────────────────────────────────────────────────────────────
    track_db_id = db.upsert_track(
        los40_track_id      = track_id_s,
        title               = track_title,
        album_id            = album_id,
        youtube_url         = clean(entry.get("youtubeUrl")),
        itunes_url          = clean(entry.get("itunesUrl")),
        apple_music_id      = clean(entry.get("appleMusicId")),
        spotify_preview_url = clean(entry.get("spotifyUrl")),
        media_url           = clean(entry.get("mediaUrl")),
    )

    # ── Artistas ─────────────────────────────────────────────────────────────
    artist_los40_id = (
        entry.get("trackArtistId") or entry.get("artistId") or ""
    ).strip()

    for sort_order, (name, aid) in enumerate(
        parse_artists(artist_raw, artist_los40_id), start=1
    ):
        if name:
            a_db_id = db.upsert_artist(name, aid)
            db.link_artist(track_db_id, a_db_id, sort_order)

    # ── Chart entry ──────────────────────────────────────────────────────────
    position   = int(entry.get("position", 0))
    last_pos   = int(entry.get("lastPosition", 0))
    two_pos    = int(entry.get("twoWeeksPosition", 0))
    best_pos   = entry.get("bestPosition")
    weeks      = int(entry.get("weeksInList", 1))
    movement   = determine_movement(position, last_pos, weeks,
                                    html_movements.get(entry_id))

    db.insert_entry(
        los40_entry_id      = entry_id or None,
        chart_id            = chart_id,
        track_id            = track_db_id,
        position            = position,
        last_position       = last_pos,
        two_weeks_position  = two_pos,
        best_position       = int(best_pos) if best_pos else None,
        weeks_in_list       = weeks,
        movement            = movement,
        strong_rise         = bool(entry.get("strongRise")),
        is_global           = bool(entry.get("isGlobal")),
    )


# ─── HTTP ─────────────────────────────────────────────────────────────────────

def fetch(url: str, session: requests.Session) -> Optional[str]:
    try:
        r = session.get(url, timeout=20)
        r.raise_for_status()
        return r.text
    except requests.RequestException as exc:
        log.error(f"HTTP error en {url}: {exc}")
        return None


# ─── MAIN ─────────────────────────────────────────────────────────────────────

def run(db_path: str, start: date, end: date, delay: float,
        single_date: Optional[str] = None):

    db      = DB(db_path)
    session = build_session(USER_AGENT, ACCEPT_LANGUAGE)

    if single_date:
        dates = [datetime.strptime(single_date, "%Y-%m-%d").date()]
    else:
        # Genera todos los sábados en el rango (la lista sale cada sábado)
        dates = []
        current = next_saturday(start)
        while current <= end:
            dates.append(current)
            current += timedelta(weeks=1)

    total = len(dates)
    scraped = skipped = errors = 0

    log_start = dates[0] if dates else start
    log_end = dates[-1] if dates else end
    log.info(f"Scraping {total} semanas · {log_start} → {log_end}")
    if (last := db.last_scraped_date()):
        log.info(f"Último chart en BD: {last}")

    try:
        for i, d in enumerate(dates, 1):
            ds  = d.strftime("%Y-%m-%d")
            url = BASE_URL.format(date=ds)

            # Saltar si ya está en BD (a menos que sea single_date manual)
            if not single_date and db.chart_exists(ds):
                skipped += 1
                if skipped % 100 == 0:
                    log.info(f"  ... saltadas {skipped} semanas ya en BD")
                continue

            log.info(f"[{i}/{total}] → {ds}")
            html = fetch(url, session)

            if html is None:
                errors += 1
                db.log_scrape(ds, None, "error", "HTTP fetch fallido")
                db.commit()
            else:
                process_page(html, ds, url, db)
                scraped += 1

            time.sleep(delay)

    except KeyboardInterrupt:
        log.info("Interrumpido por el usuario (Ctrl+C)")

    finally:
        db.close()
        log.info(
            f"\n══ Resumen ══════════════════════\n"
            f"  Scraped : {scraped}\n"
            f"  Saltadas: {skipped}\n"
            f"  Errores : {errors}\n"
            f"════════════════════════════════"
        )


if __name__ == "__main__":
    ap = argparse.ArgumentParser(
        description="LOS40 Historical Chart Scraper",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Ejemplos:
  python los40_scraper.py                        # todo desde 1969
  python los40_scraper.py --start 2004-01-01     # solo era moderna (40 canciones)
  python los40_scraper.py --date  2004-01-03     # prueba con una sola semana
  python los40_scraper.py --delay 2.5            # más lento y cortés
        """,
    )
    ap.add_argument("--db",    default=DB_PATH,
                    help=f"Ruta al fichero SQLite (default: {DB_PATH})")
    ap.add_argument("--start", default="1969-02-01",
                    help="Fecha inicio YYYY-MM-DD (default: 1969-02-01)")
    ap.add_argument("--end",   default=date.today().strftime("%Y-%m-%d"),
                    help="Fecha fin YYYY-MM-DD (default: hoy)")
    ap.add_argument("--delay", type=float, default=REQUEST_DELAY,
                    help=f"Segundos entre peticiones (default: {REQUEST_DELAY})")
    ap.add_argument("--date",  default=None,
                    help="Scrape solo esta semana YYYY-MM-DD (para tests)")
    args = ap.parse_args()

    run(
        db_path     = args.db,
        start       = datetime.strptime(args.start, "%Y-%m-%d").date(),
        end         = datetime.strptime(args.end,   "%Y-%m-%d").date(),
        delay       = args.delay,
        single_date = args.date,
    )
