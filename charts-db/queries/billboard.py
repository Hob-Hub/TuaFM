#!/usr/bin/env python3
"""Command-line queries for billboard_year_end_hot100.db."""

import argparse
import csv
import sqlite3
import sys
from pathlib import Path

DB_PATH = "billboard_year_end_hot100.db"


def configure_output_encoding():
    for stream in (sys.stdout, sys.stderr):
        if hasattr(stream, "reconfigure"):
            stream.reconfigure(encoding="utf-8", errors="replace")


configure_output_encoding()


def get_db(path: str) -> sqlite3.Connection:
    if not Path(path).exists():
        print(f"Error: database not found: {path}")
        print("Run first: python billboard_year_end_scraper.py")
        sys.exit(1)
    con = sqlite3.connect(path)
    con.row_factory = sqlite3.Row
    return con


def cmd_stats(con: sqlite3.Connection, args):
    rows = {
        "Years": "SELECT COUNT(*) FROM year_end_charts",
        "Entries": "SELECT COUNT(*) FROM year_end_entries",
        "Tracks": "SELECT COUNT(*) FROM tracks",
        "Artists": "SELECT COUNT(*) FROM artists",
    }
    print("\nBillboard Year-End Hot 100 · Stats\n")
    for label, sql in rows.items():
        print(f"  {label:<10} {con.execute(sql).fetchone()[0]:>8}")
    first, last = con.execute("SELECT MIN(chart_year), MAX(chart_year) FROM year_end_charts").fetchone()
    print(f"\n  Range: {first} → {last}")
    print("\n  Entry count breakdown")
    for r in con.execute("SELECT entry_count, COUNT(*) n FROM year_end_charts GROUP BY entry_count ORDER BY entry_count"):
        print(f"    {r['entry_count']:>3} entries: {r['n']} years")
    print("\n  Top artists by appearances")
    for i, r in enumerate(con.execute("""
        SELECT a.name, COUNT(*) appearances
        FROM year_end_entries ye
        JOIN track_artists ta ON ye.track_id = ta.track_id
        JOIN artists a ON ta.artist_id = a.id
        GROUP BY a.id
        ORDER BY appearances DESC, a.name
        LIMIT 10
    """), start=1):
        print(f"    {i:>2}. {r['name']:<35} {r['appearances']}")


def cmd_year(con: sqlite3.Connection, args):
    rows = con.execute(
        "SELECT * FROM v_chart WHERE chart_year = ? ORDER BY position, chart_entry_id",
        (args.year,),
    ).fetchall()
    if not rows:
        print(f"No data for {args.year}")
        return
    print(f"\nBillboard Year-End Hot 100 · {args.year} ({len(rows)} entries)\n")
    for r in rows:
        print(f"  {r['position']:>3}. {r['song']:<45} {r['artists']}")


def cmd_artist(con: sqlite3.Connection, args):
    rows = con.execute("""
        SELECT chart_year, position, song, artists
        FROM v_chart
        WHERE artists LIKE ?
        ORDER BY chart_year, position
    """, (f"%{args.artist}%",)).fetchall()
    if not rows:
        print(f"No entries for artist: {args.artist}")
        return
    print(f"\n{args.artist} · {len(rows)} Year-End appearances\n")
    for r in rows:
        print(f"  {r['chart_year']}  #{r['position']:<3} {r['song']} — {r['artists']}")


def cmd_song(con: sqlite3.Connection, args):
    rows = con.execute("""
        SELECT chart_year, position, song, artists
        FROM v_chart
        WHERE song LIKE ?
        ORDER BY chart_year, position
    """, (f"%{args.song}%",)).fetchall()
    if not rows:
        print(f"No entries for song: {args.song}")
        return
    for r in rows:
        print(f"{r['chart_year']}  #{r['position']:<3} {r['song']} — {r['artists']}")


def cmd_number1(con: sqlite3.Connection, args):
    rows = con.execute("SELECT * FROM v_number_ones ORDER BY chart_year").fetchall()
    print(f"\nBillboard Year-End No. 1s ({len(rows)})\n")
    for r in rows:
        print(f"  {r['chart_year']}  {r['song']:<45} {r['artist']}")


def cmd_missing(con: sqlite3.Connection, args):
    first, last = con.execute("SELECT MIN(chart_year), MAX(chart_year) FROM year_end_charts").fetchone()
    if first is None:
        print("Database is empty")
        return
    present = {r[0] for r in con.execute("SELECT chart_year FROM year_end_charts")}
    missing = [y for y in range(first, last + 1) if y not in present]
    if not missing:
        print(f"\nNo missing years between {first} and {last}\n")
    else:
        print(f"\nMissing years between {first} and {last}: {missing}\n")


def cmd_export(con: sqlite3.Connection, args):
    rows = con.execute("""
        SELECT chart_year, chart_date, position, song, artists, source_artist_text,
               song_wikipedia_url, source_url
        FROM v_chart
        ORDER BY chart_year, position, chart_entry_id
    """).fetchall()
    fname = args.output or "billboard_year_end_hot100.csv"
    with open(fname, "w", newline="", encoding="utf-8") as f:
        writer = csv.writer(f)
        writer.writerow(rows[0].keys() if rows else [])
        writer.writerows([list(r) for r in rows])
    print(f"Exported: {fname} ({len(rows)} rows)")


def main():
    ap = argparse.ArgumentParser(description="Billboard Year-End Hot 100 queries")
    ap.add_argument("--db", default=DB_PATH)
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("stats")
    p = sub.add_parser("year"); p.add_argument("year", type=int)
    p = sub.add_parser("artist"); p.add_argument("artist")
    p = sub.add_parser("song"); p.add_argument("song")
    sub.add_parser("number1")
    sub.add_parser("missing")
    p = sub.add_parser("export"); p.add_argument("--output", default=None)
    args = ap.parse_args()

    con = get_db(args.db)
    try:
        {
            "stats": cmd_stats,
            "year": cmd_year,
            "artist": cmd_artist,
            "song": cmd_song,
            "number1": cmd_number1,
            "missing": cmd_missing,
            "export": cmd_export,
        }[args.cmd](con, args)
    finally:
        con.close()


if __name__ == "__main__":
    main()
