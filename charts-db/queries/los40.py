#!/usr/bin/env python3
"""
LOS40 Chart Explorer — Consultas y análisis desde la línea de comandos
═══════════════════════════════════════════════════════════════════════

Uso:
    python los40_queries.py stats                          # estadísticas generales
    python los40_queries.py week    2004-01-03             # lista de una semana
    python los40_queries.py artist  "Alejandro Sanz"       # historial de un artista
    python los40_queries.py song    "Tequila"              # historial de una canción
    python los40_queries.py number1 [--year 2004]          # todos los nº1 (o de un año)
    python los40_queries.py top     [--year 2004]          # top canciones por semanas
    python los40_queries.py birthday 1990-09-15            # nº1 el día que naciste
    python los40_queries.py covers  [--year 2004]          # portadas disponibles
    python los40_queries.py missing                        # semanas sin datos
    python los40_queries.py export  --format csv [--year 2004]  # exportar a CSV
"""

import sqlite3
import argparse
import csv
import sys
import os
from pathlib import Path
from datetime import datetime, date, timedelta
from typing import Optional

DB_PATH = "los40.db"


def configure_output_encoding():
    for stream in (sys.stdout, sys.stderr):
        if hasattr(stream, "reconfigure"):
            stream.reconfigure(encoding="utf-8", errors="replace")


configure_output_encoding()

# ANSI colors (desactivados si no es terminal)
_TTY = sys.stdout.isatty()

def _c(code, txt):
    return f"\033[{code}m{txt}\033[0m" if _TTY else txt

def red(t):     return _c("31", t)
def green(t):   return _c("32", t)
def yellow(t):  return _c("33", t)
def cyan(t):    return _c("36", t)
def bold(t):    return _c("1",  t)
def dim(t):     return _c("2",  t)


# ─── DB ───────────────────────────────────────────────────────────────────────

def get_db(path: str) -> sqlite3.Connection:
    if not Path(path).exists():
        print(red(f"Error: base de datos no encontrada: {path}"))
        print(f"  Lanza primero el scraper:  python los40_scraper.py --date 2004-01-03")
        sys.exit(1)
    con = sqlite3.connect(path)
    con.row_factory = sqlite3.Row
    return con


# ─── MOVIMIENTO ───────────────────────────────────────────────────────────────

_MOVE = {
    "new":  "🆕",
    "up":   "↑ ",
    "down": "↓ ",
    "same": "=  ",
    None:   "   ",
}


# ─── COMANDOS ─────────────────────────────────────────────────────────────────

def cmd_stats(con: sqlite3.Connection, args):
    """Estadísticas generales de la base de datos."""
    print(bold("\n══ LOS40 · Estadísticas ══════════════════════════════\n"))

    rows = {
        "Semanas en BD":     "SELECT COUNT(*) FROM charts",
        "Entradas en BD":    "SELECT COUNT(*) FROM chart_entries",
        "Canciones únicas":  "SELECT COUNT(*) FROM tracks",
        "Artistas únicos":   "SELECT COUNT(*) FROM artists",
        "Álbumes únicos":    "SELECT COUNT(*) FROM albums",
    }
    for label, sql in rows.items():
        n = con.execute(sql).fetchone()[0]
        print(f"  {label:<22} {bold(str(n)):>10}")

    first = con.execute("SELECT MIN(chart_date) FROM charts").fetchone()[0]
    last  = con.execute("SELECT MAX(chart_date) FROM charts").fetchone()[0]
    print(f"\n  Primer chart : {green(first or '—')}")
    print(f"  Último chart : {green(last  or '—')}")

    # Desglose por tamaño de lista
    print(f"\n  Semanas con 40 entradas: {con.execute('SELECT COUNT(*) FROM charts WHERE entry_count=40').fetchone()[0]}")
    print(f"  Semanas con 1 entrada  : {con.execute('SELECT COUNT(*) FROM charts WHERE entry_count=1').fetchone()[0]}")

    # Artistas con más semanas en lista
    print(bold("\n  Top 10 artistas por semanas en lista\n"))
    rows = con.execute("""
        SELECT a.name, COUNT(*) AS apariciones
        FROM chart_entries ce
        JOIN track_artists ta ON ce.track_id = ta.track_id AND ta.sort_order=1
        JOIN artists a ON ta.artist_id = a.id
        GROUP BY a.id
        ORDER BY apariciones DESC LIMIT 10
    """).fetchall()
    for i, r in enumerate(rows, 1):
        print(f"  {i:>2}. {r['name']:<35} {r['apariciones']} semanas")

    # Artistas con más nº1
    print(bold("\n  Top 10 artistas en el Nº1\n"))
    rows = con.execute("""
        SELECT artist, COUNT(*) AS n
        FROM v_number_ones
        GROUP BY artist ORDER BY n DESC LIMIT 10
    """).fetchall()
    for i, r in enumerate(rows, 1):
        print(f"  {i:>2}. {r['artist']:<35} {r['n']} semanas")

    print()


def cmd_week(con: sqlite3.Connection, args):
    """Muestra la lista de una semana concreta."""
    d = args.week_date

    # Si no es sábado exacto, buscar el sábado más cercano de la BD
    rows = con.execute("""
        SELECT * FROM v_chart WHERE chart_date = ?
        ORDER BY position, chart_entry_id
    """, (d,)).fetchall()

    if not rows:
        # Buscar semana más cercana
        near = con.execute("""
            SELECT chart_date FROM charts
            WHERE chart_date <= ? ORDER BY chart_date DESC LIMIT 1
        """, (d,)).fetchone()
        if near:
            d = near["chart_date"]
            rows = con.execute(
                "SELECT * FROM v_chart WHERE chart_date = ? ORDER BY position, chart_entry_id", (d,)
            ).fetchall()

    if not rows:
        print(red(f"No hay datos para la semana del {d}"))
        return

    print(bold(f"\n══ LOS40 · Semana del {green(d)} ({'Lista de 40' if len(rows)==40 else f'{len(rows)} entrada(s)'})\n"))
    print(f"  {'Pos':>3}  {'Mv':^3}  {'Sem':>3}  {'Título':<40}  {'Artista(s)'}")
    print(f"  {'─'*3}  {'─'*3}  {'─'*3}  {'─'*40}  {'─'*30}")

    for r in rows:
        mv   = _MOVE.get(r["movement"], "   ")
        wks  = str(r["weeks_in_list"]) if r["weeks_in_list"] else "-"
        pos  = str(r["position"])
        # Color por posición
        pos_s = bold(green(f"#{pos}")) if r["position"] == 1 else f"#{pos}"
        song  = (r["song"] or "")[:40]
        artst = (r["artists"] or "")[:45]
        print(f"  {pos_s:>5}  {mv}  {wks:>3}s  {song:<40}  {dim(artst)}")

    # Preview links para el nº1
    top = rows[0]
    print(bold(f"\n  Nº1: {top['song']} — {top['artists']}"))
    if top["youtube_url"]:
        print(f"  YouTube  → {cyan(top['youtube_url'])}")
    if top["spotify_preview_url"]:
        print(f"  Spotify  → {cyan(top['spotify_preview_url'])}")
    if top["cover_url"]:
        print(f"  Portada  → {cyan(top['cover_url'])}")
    print()


def cmd_artist(con: sqlite3.Connection, args):
    """Historial de apariciones de un artista."""
    name = args.artist_name

    rows = con.execute("""
        SELECT v.chart_date, v.position, v.movement, v.weeks_in_list,
               v.song, v.artists, v.best_position
        FROM v_chart v
        WHERE v.artists LIKE ?
        ORDER BY v.chart_date, v.position, v.chart_entry_id
    """, (f"%{name}%",)).fetchall()

    if not rows:
        print(red(f"No se encontraron entradas para artista: '{name}'"))
        return

    # Agrupar por canción
    songs_seen: dict = {}
    for r in rows:
        songs_seen.setdefault(r["song"], []).append(r)

    print(bold(f"\n══ LOS40 · {cyan(name)} ── {len(rows)} apariciones en {len(songs_seen)} canciones\n"))

    for song, srows in songs_seen.items():
        first_date  = srows[0]["chart_date"]
        last_date   = srows[-1]["chart_date"]
        best_pos    = min(r["position"] for r in srows)
        total_weeks = len(srows)
        numb1       = sum(1 for r in srows if r["position"] == 1)

        print(f"  ▶  {bold(song)}")
        print(f"     {first_date} → {last_date} · "
              f"{total_weeks} semanas · pico #{best_pos}"
              + (f" · {bold(green(str(numb1)+' sem. Nº1'))} 🏆" if numb1 else ""))

        # Mostrar primeras/últimas si hay muchas
        display = srows if len(srows) <= 12 else (srows[:6] + [None] + srows[-3:])
        for r in display:
            if r is None:
                print(f"        {dim('  ···  ')}")
                continue
            mv = _MOVE.get(r["movement"], "   ")
            print(f"        {r['chart_date']}  #{r['position']:<3} {mv}  {r['weeks_in_list']}s")
        print()


def cmd_song(con: sqlite3.Connection, args):
    """Historial de una canción."""
    title = args.song_title

    rows = con.execute("""
        SELECT * FROM v_chart
        WHERE song LIKE ?
        ORDER BY chart_date, position, chart_entry_id
    """, (f"%{title}%",)).fetchall()

    if not rows:
        print(red(f"No se encontraron entradas para: '{title}'"))
        return

    # Puede haber varias canciones distintas con título similar
    by_track: dict = {}
    for r in rows:
        key = r["los40_track_id"] or r["song"]
        by_track.setdefault(key, []).append(r)

    for track_id, trows in by_track.items():
        r0 = trows[0]
        best = min(x["position"] for x in trows)
        print(bold(f"\n══ {green(r0['song'])} ── {r0['artists']}\n"))
        print(f"  Álbum   : {r0['album'] or '—'} ({r0['album_year'] or '?'})")
        print(f"  Portada : {cyan(r0['cover_url']) if r0['cover_url'] else '—'}")
        print(f"  YouTube : {cyan(r0['youtube_url']) if r0['youtube_url'] else '—'}")
        print(f"  Spotify : {cyan(r0['spotify_preview_url']) if r0['spotify_preview_url'] else '—'}")
        print(f"  Audio   : {cyan(r0['media_url']) if r0['media_url'] else '—'}")
        print(f"\n  {len(trows)} semanas en lista · mejor posición: #{bold(str(best))}\n")
        print(f"  {'Fecha':<12}  {'Pos':>4}  {'Mv':^3}  {'Sem':>4}  {'Anterior':>9}")
        print(f"  {'─'*12}  {'─'*4}  {'─'*3}  {'─'*4}  {'─'*9}")
        for r in trows:
            mv      = _MOVE.get(r["movement"], "   ")
            last_s  = f"(antes #{r['last_position']})" if r["last_position"] else ""
            pos_s   = bold(green(f"#{r['position']}")) if r["position"]==1 else f"#{r['position']}"
            print(f"  {r['chart_date']}  {pos_s:>6}  {mv}  {r['weeks_in_list']:>3}s  {dim(last_s)}")
    print()


def cmd_number1(con: sqlite3.Connection, args):
    """Lista todos los números 1 (opcionalmente filtrado por año)."""
    year = getattr(args, "year", None)

    q = "SELECT * FROM v_number_ones"
    p = ()
    if year:
        q += " WHERE chart_date LIKE ?"
        p  = (f"{year}-%",)
    q += " ORDER BY chart_date"

    rows = con.execute(q, p).fetchall()
    if not rows:
        print(red(f"Sin datos de nº1{' para ' + str(year) if year else ''}"))
        return

    title_s = f"Año {year}" if year else "Histórico completo"
    print(bold(f"\n══ LOS40 · Números 1 — {title_s} ({len(rows)} semanas)\n"))
    print(f"  {'Fecha':<12}  {'Artista':<35}  {'Canción'}")
    print(f"  {'─'*12}  {'─'*35}  {'─'*40}")

    prev_year = None
    for r in rows:
        y = r["chart_date"][:4]
        if y != prev_year:
            print(bold(f"\n  ── {y} " + "─"*50))
            prev_year = y
        print(f"  {r['chart_date']}  {r['artist']:<35}  {r['song']}")
    print()


def cmd_birthday(con: sqlite3.Connection, args):
    """¿Qué era nº1 el día que naciste?"""
    birth_date = args.birthday

    row = con.execute("""
        SELECT * FROM v_number_ones
        WHERE chart_date <= ?
        ORDER BY chart_date DESC LIMIT 1
    """, (birth_date,)).fetchone()

    if not row:
        print(red(f"Sin datos anteriores a {birth_date}"))
        return

    print(bold(f"\n  🎂  El {cyan(birth_date)} el Nº1 era:\n"))
    print(f"       {bold(green(row['song']))}")
    print(f"       {row['artist']}")
    print(f"       (chart del {row['chart_date']})")
    if row["cover_url"]:
        print(f"       Portada → {cyan(row['cover_url'])}")
    print()


def cmd_top(con: sqlite3.Connection, args):
    """Top canciones por semanas en lista."""
    year  = getattr(args, "year", None)
    limit = getattr(args, "limit", 25)

    if year:
        filter_sql = f"AND c.chart_date LIKE '{year}-%'"
    else:
        filter_sql = ""

    rows = con.execute(f"""
        SELECT t.title AS song,
               GROUP_CONCAT(DISTINCT a.name) AS artists,
               COUNT(DISTINCT ce.chart_id) AS semanas,
               MIN(ce.position) AS pico,
               al.cover_url
        FROM chart_entries ce
        JOIN charts c    ON ce.chart_id  = c.id
        JOIN tracks t    ON ce.track_id  = t.id
        LEFT JOIN albums  al ON t.album_id   = al.id
        LEFT JOIN track_artists ta ON t.id   = ta.track_id
        LEFT JOIN artists a  ON ta.artist_id = a.id
        WHERE 1=1 {filter_sql}
        GROUP BY t.id
        ORDER BY semanas DESC, pico
        LIMIT ?
    """, (limit,)).fetchall()

    year_s = str(year) if year else "histórico"
    print(bold(f"\n══ LOS40 · Top {limit} canciones por semanas ({year_s})\n"))
    print(f"  {'#':>3}  {'Sem':>4}  {'Pico':>5}  {'Canción':<40}  Artista(s)")
    print(f"  {'─'*3}  {'─'*4}  {'─'*5}  {'─'*40}  {'─'*30}")
    for i, r in enumerate(rows, 1):
        print(f"  {i:>3}  {r['semanas']:>4}s  #{r['pico']:<4}  {r['song']:<40}  {dim(r['artists'] or '')}")
    print()


def cmd_covers(con: sqlite3.Connection, args):
    """Lista las portadas disponibles (para una época)."""
    year = getattr(args, "year", None)
    flt  = f"AND chart_date LIKE '{year}-%'" if year else ""

    rows = con.execute(f"""
        SELECT DISTINCT cover_url, song, artists, album, album_year
        FROM v_chart
        WHERE cover_url IS NOT NULL {flt}
        ORDER BY chart_date
        LIMIT 200
    """).fetchall()

    print(bold(f"\n══ LOS40 · Portadas disponibles{' ─ ' + str(year) if year else ''} ({len(rows)})\n"))
    for r in rows:
        print(f"  {r['artists']:<35} ─ {r['song']}")
        print(f"  {dim(r['cover_url'])}\n")


def cmd_missing(con: sqlite3.Connection, args):
    """Detecta semanas sin datos entre la primera y la última scraped."""
    first_s = con.execute("SELECT MIN(chart_date) FROM charts").fetchone()[0]
    last_s  = con.execute("SELECT MAX(chart_date) FROM charts").fetchone()[0]
    if not first_s:
        print(red("La BD está vacía."))
        return

    scraped = set(
        r[0] for r in con.execute("SELECT chart_date FROM charts").fetchall()
    )

    first = datetime.strptime(first_s, "%Y-%m-%d").date()
    last  = datetime.strptime(last_s,  "%Y-%m-%d").date()

    missing = []
    cur = first
    while cur <= last:
        ds = cur.strftime("%Y-%m-%d")
        if ds not in scraped:
            missing.append(ds)
        cur += timedelta(weeks=1)

    if not missing:
        print(green(f"\n  ✓ Sin huecos entre {first_s} y {last_s}\n"))
    else:
        print(bold(f"\n  ⚠  {len(missing)} semanas sin datos entre {first_s} y {last_s}:\n"))
        for d in missing:
            print(f"     {d}")
        print()


def cmd_export(con: sqlite3.Connection, args):
    """Exporta la BD a CSV."""
    year   = getattr(args, "year", None)
    fmt    = getattr(args, "format", "csv")
    flt    = f"WHERE chart_date LIKE '{year}-%'" if year else ""

    rows = con.execute(f"""
        SELECT chart_date, position, movement, weeks_in_list,
               best_position, last_position, two_weeks_position,
               strong_rise, is_global,
               song, artists, album, album_year,
               cover_url, youtube_url, spotify_preview_url,
               media_url, itunes_url, apple_music_id, los40_track_id
        FROM v_chart
        {flt}
        ORDER BY chart_date, position
    """).fetchall()

    fname = f"los40{'_'+str(year) if year else ''}.csv"
    with open(fname, "w", newline="", encoding="utf-8") as f:
        writer = csv.writer(f)
        writer.writerow(rows[0].keys() if rows else [])
        writer.writerows([list(r) for r in rows])

    print(green(f"\n  ✓ Exportado: {fname}  ({len(rows)} filas)\n"))


# ─── MAIN ─────────────────────────────────────────────────────────────────────

def main():
    ap = argparse.ArgumentParser(
        description="LOS40 Chart Explorer",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )
    ap.add_argument("--db", default=DB_PATH,
                    help=f"Ruta al SQLite (default: {DB_PATH})")

    sub = ap.add_subparsers(dest="cmd", required=True)

    sub.add_parser("stats")

    p = sub.add_parser("week")
    p.add_argument("week_date", help="YYYY-MM-DD")

    p = sub.add_parser("artist")
    p.add_argument("artist_name")

    p = sub.add_parser("song")
    p.add_argument("song_title")

    p = sub.add_parser("number1")
    p.add_argument("--year", type=int, default=None)

    p = sub.add_parser("top")
    p.add_argument("--year",  type=int, default=None)
    p.add_argument("--limit", type=int, default=25)

    p = sub.add_parser("birthday")
    p.add_argument("birthday", help="YYYY-MM-DD")

    p = sub.add_parser("covers")
    p.add_argument("--year", type=int, default=None)

    sub.add_parser("missing")

    p = sub.add_parser("export")
    p.add_argument("--year",   type=int,   default=None)
    p.add_argument("--format", default="csv")

    args = ap.parse_args()
    con  = get_db(args.db)

    dispatch = {
        "stats":    cmd_stats,
        "week":     cmd_week,
        "artist":   cmd_artist,
        "song":     cmd_song,
        "number1":  cmd_number1,
        "top":      cmd_top,
        "birthday": cmd_birthday,
        "covers":   cmd_covers,
        "missing":  cmd_missing,
        "export":   cmd_export,
    }
    dispatch[args.cmd](con, args)
    con.close()


if __name__ == "__main__":
    main()
