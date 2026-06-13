#!/usr/bin/env python3
"""
Scrape Billboard Year-End Hot 100 singles from Wikipedia into SQLite.

Default range: 1958 through the previous calendar year.
1958 is stored as-is even though the source page is a top 50, because the Hot
100 launched in August 1958.
"""

import argparse
import csv
import re
import sqlite3
import sys
import time
import unicodedata
from html import unescape
from pathlib import Path
from typing import List, Optional, Tuple
from urllib.parse import urljoin
from datetime import date

from bs4 import BeautifulSoup

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from lib.common import build_session, configure_output_encoding, fetch_url, setup_logging


DB_PATH = "billboard_year_end_hot100.db"
START_YEAR = 1958
BASE_URL = "https://en.wikipedia.org/wiki/Billboard_Year-End_Hot_100_singles_of_{year}"
REQUEST_DELAY = 2.0
USER_AGENT = "TuaFM Billboard Year-End scraper/1.0 (personal local script)"

SCHEMA = (Path(__file__).resolve().parent.parent / "schema" / "billboard.sql").read_text(encoding="utf-8")

KNOWN_ARTIST_FIXES = {
    (1964, 2): "The Beatles",
    (1964, 14): "The Beatles",
    (1964, 25): "The Four Seasons",
    (1991, 72): "UB40",
}


configure_output_encoding()
log = setup_logging("billboard.log", __name__)


def normalize_key(value: str) -> str:
    s = unicodedata.normalize("NFD", value or "")
    s = "".join(ch for ch in s if unicodedata.category(ch) != "Mn")
    s = re.sub(r"\s+", " ", s.lower()).strip()
    return s


def clean_text(value: str) -> str:
    s = unescape(value or "")
    s = re.sub(r"\[[^\]]+\]", "", s)
    s = re.sub(r"\s+", " ", s).strip()
    return s


def clean_title(value: str) -> str:
    s = clean_text(value)
    s = s.strip('"“”')
    s = re.sub(r'\s*"\s*/\s*"\s*', " / ", s)
    s = re.sub(r"\s*/\s*", " / ", s)
    return re.sub(r"\s+", " ", s).strip()


def wiki_url(a) -> Optional[str]:
    href = a.get("href") if a else None
    if not href or href.startswith("#"):
        return None
    return urljoin("https://en.wikipedia.org", href)


class DB:
    def __init__(self, path: str):
        self.con = sqlite3.connect(path)
        self.con.row_factory = sqlite3.Row
        self.con.executescript(SCHEMA)
        self.con.commit()
        log.info(f"Base de datos: {Path(path).absolute()}")

    def chart_exists(self, year: int) -> bool:
        return self.con.execute(
            "SELECT 1 FROM year_end_charts WHERE chart_year = ?", (year,)
        ).fetchone() is not None

    def upsert_artist(self, name: str, url: Optional[str]) -> int:
        key = normalize_key(name)
        self.con.execute(
            """INSERT INTO artists (name, name_key, wikipedia_url)
               VALUES (?, ?, ?)
               ON CONFLICT(name_key) DO UPDATE SET
               name = excluded.name,
               wikipedia_url = COALESCE(excluded.wikipedia_url, wikipedia_url)""",
            (name, key, url),
        )
        return self.con.execute(
            "SELECT id FROM artists WHERE name_key = ?", (key,)
        ).fetchone()["id"]

    def upsert_track(self, title: str, artist_key: str, url: Optional[str]) -> int:
        title_key = normalize_key(title)
        self.con.execute(
            """INSERT INTO tracks (title, title_key, artist_key, wikipedia_url)
               VALUES (?, ?, ?, ?)
               ON CONFLICT(title_key, artist_key) DO UPDATE SET
               title = excluded.title,
               wikipedia_url = COALESCE(excluded.wikipedia_url, wikipedia_url)""",
            (title, title_key, artist_key, url),
        )
        return self.con.execute(
            "SELECT id FROM tracks WHERE title_key = ? AND artist_key = ?",
            (title_key, artist_key),
        ).fetchone()["id"]

    def link_artist(self, track_id: int, artist_id: int, sort_order: int):
        self.con.execute(
            """INSERT OR IGNORE INTO track_artists (track_id, artist_id, sort_order)
               VALUES (?, ?, ?)""",
            (track_id, artist_id, sort_order),
        )

    def upsert_chart(self, year: int, source_title: str, source_url: str, count: int) -> int:
        chart_date = f"{year}-07-01"
        self.con.execute(
            """INSERT INTO year_end_charts
               (chart_year, chart_date, source_title, source_url, entry_count)
               VALUES (?, ?, ?, ?, ?)
               ON CONFLICT(chart_year) DO UPDATE SET
               source_title = excluded.source_title,
               source_url = excluded.source_url,
               entry_count = excluded.entry_count""",
            (year, chart_date, source_title, source_url, count),
        )
        return self.con.execute(
            "SELECT id FROM year_end_charts WHERE chart_year = ?", (year,)
        ).fetchone()["id"]

    def clear_chart_entries(self, chart_id: int):
        self.con.execute("DELETE FROM year_end_entries WHERE chart_id = ?", (chart_id,))

    def cleanup_orphans(self):
        self.con.execute(
            """DELETE FROM track_artists
               WHERE track_id IN (
                   SELECT t.id FROM tracks t
                   LEFT JOIN year_end_entries ye ON ye.track_id = t.id
                   WHERE ye.id IS NULL
               )"""
        )
        self.con.execute(
            """DELETE FROM tracks
               WHERE id NOT IN (SELECT DISTINCT track_id FROM year_end_entries)"""
        )
        self.con.execute(
            """DELETE FROM artists
               WHERE id NOT IN (SELECT DISTINCT artist_id FROM track_artists)"""
        )

    def insert_entry(
        self,
        chart_id: int,
        rank: int,
        track_id: int,
        title: str,
        artist_text: str,
        artist_list: str,
        source_url: str,
    ):
        self.con.execute(
            """INSERT INTO year_end_entries
               (chart_id, track_id, rank, source_title, source_artist_text,
                source_artist_list, source_url)
               VALUES (?, ?, ?, ?, ?, ?, ?)
               ON CONFLICT(chart_id, rank, track_id) DO UPDATE SET
               track_id = excluded.track_id,
               source_title = excluded.source_title,
               source_artist_text = excluded.source_artist_text,
               source_artist_list = excluded.source_artist_list,
               source_url = excluded.source_url""",
            (chart_id, track_id, rank, title, artist_text, artist_list, source_url),
        )

    def log_scrape(self, year: int, status: str, message: str = ""):
        self.con.execute(
            "INSERT INTO scrape_log (chart_year, status, message) VALUES (?, ?, ?)",
            (year, status, message),
        )

    def commit(self):
        self.con.commit()

    def close(self):
        self.con.close()


def find_year_end_table(soup: BeautifulSoup):
    for table in soup.select("table.wikitable"):
        headers = [clean_text(th.get_text(" ", strip=True)).lower() for th in table.select("tr th")]
        header_text = " ".join(headers)
        if ("title" in header_text and "artist" in header_text and
                ("no." in header_text or "№" in header_text or "no" in header_text)):
            return table
    return soup.select_one("table.wikitable")


def extract_artists(cell) -> List[Tuple[str, Optional[str]]]:
    raw = clean_text(cell.get_text(" ", strip=True))

    # Some soundtrack groups are written as "Group: A, B, C and D"; not every
    # person is linked, so anchor-only extraction loses names.
    if ":" in raw:
        group, members = raw.split(":", 1)
        parts = [group]
        parts.extend(re.split(r"\s*,\s*|\s+\band\b\s+|\s*&\s*", members))
        result = []
        seen = set()
        for part in parts:
            name = clean_text(part)
            key = normalize_key(name)
            if name and key and key not in seen:
                result.append((name, None))
                seen.add(key)
        if result:
            return result

    artists: List[Tuple[str, Optional[str]]] = []
    seen = set()
    for a in cell.find_all("a"):
        name = clean_text(a.get_text(" ", strip=True))
        href = a.get("href", "")
        if not name or href.startswith("#") or "/wiki/" not in href:
            continue
        key = normalize_key(name)
        if key and key not in seen:
            artists.append((name, wiki_url(a)))
            seen.add(key)

    if artists:
        return artists

    return [(raw, None)] if raw else []


def infer_artist_from_title_link(title_link) -> Optional[str]:
    if not title_link:
        return None
    title_attr = clean_text(title_link.get("title", ""))
    m = re.search(r"\((.+?)\s+song\)$", title_attr, flags=re.IGNORECASE)
    if not m:
        return None
    artist = clean_text(m.group(1))
    return artist or None


def parse_entries(html: str, year: Optional[int] = None) -> Tuple[str, List[dict]]:
    soup = BeautifulSoup(html, "lxml")
    h1 = soup.select_one("h1")
    page_title = clean_text(h1.get_text(" ", strip=True)) if h1 else ""
    table = find_year_end_table(soup)
    if table is None:
        return page_title, []

    entries = []
    for tr in table.select("tr"):
        cells = tr.find_all(["td", "th"])
        if len(cells) < 2:
            continue
        rank_text = clean_text(cells[0].get_text(" ", strip=True)).replace("№", "")
        if not rank_text.isdigit():
            continue
        rank = int(rank_text)
        title_cell = cells[1]
        artist_cell = cells[2] if len(cells) >= 3 else None
        title = clean_title(title_cell.get_text(" ", strip=True))
        if not title:
            continue
        title_link = title_cell.find("a")
        if artist_cell is not None:
            artists = extract_artists(artist_cell)
            artist_text = clean_text(artist_cell.get_text(" ", strip=True))
        else:
            inferred = None
            if year is not None:
                inferred = KNOWN_ARTIST_FIXES.get((year, rank))
            inferred = inferred or infer_artist_from_title_link(title_link) or "Unknown Artist"
            artists = [(inferred, None)]
            artist_text = inferred
        artist_list = "; ".join(name for name, _ in artists) or artist_text
        artist_key = normalize_key(artist_list)
        entries.append({
            "rank": rank,
            "title": title,
            "title_url": wiki_url(title_link),
            "artists": artists,
            "artist_text": artist_text,
            "artist_list": artist_list,
            "artist_key": artist_key,
        })

    entries.sort(key=lambda e: e["rank"])
    return page_title, entries


def process_year(year: int, html: str, url: str, db: DB):
    page_title, entries = parse_entries(html, year)
    if not entries:
        log.warning(f"{year}: sin tabla de entradas")
        db.log_scrape(year, "empty", "no year-end entries")
        db.commit()
        return

    chart_id = db.upsert_chart(year, page_title, url, len(entries))
    db.clear_chart_entries(chart_id)
    ok = 0
    for entry in entries:
        track_id = db.upsert_track(entry["title"], entry["artist_key"], entry["title_url"])
        for i, (artist_name, artist_url) in enumerate(entry["artists"], start=1):
            artist_id = db.upsert_artist(artist_name, artist_url)
            db.link_artist(track_id, artist_id, i)
        db.insert_entry(
            chart_id=chart_id,
            rank=entry["rank"],
            track_id=track_id,
            title=entry["title"],
            artist_text=entry["artist_text"],
            artist_list=entry["artist_list"],
            source_url=url,
        )
        ok += 1

    db.log_scrape(year, "success", f"{ok} entradas")
    db.cleanup_orphans()
    db.commit()
    log.info(f"  ✓ {year} · {ok} entradas · {page_title}")


def run(db_path: str, start_year: int, end_year: int, delay: float, single_year: Optional[int]):
    db = DB(db_path)
    session = build_session(USER_AGENT)
    years = [single_year] if single_year else list(range(start_year, end_year + 1))

    scraped = skipped = errors = 0
    log.info(f"Scraping {len(years)} años · {years[0]} → {years[-1]}")

    try:
        for i, year in enumerate(years, start=1):
            if not single_year and db.chart_exists(year):
                skipped += 1
                continue
            log.info(f"[{i}/{len(years)}] → {year}")
            html, url = fetch_url(BASE_URL.format(year=year), session, log=log)
            if html is None:
                errors += 1
                db.log_scrape(year, "error", "HTTP fetch failed")
                db.commit()
            else:
                process_year(year, html, url, db)
                scraped += 1
            time.sleep(delay)
    finally:
        db.close()
        log.info(
            "\n══ Resumen ══════════════════════\n"
            f"  Scraped : {scraped}\n"
            f"  Saltados: {skipped}\n"
            f"  Errores : {errors}\n"
            "════════════════════════════════"
        )


def main():
    default_end = date.today().year - 1
    ap = argparse.ArgumentParser(description="Billboard Year-End Hot 100 scraper")
    ap.add_argument("--db", default=DB_PATH, help=f"SQLite path (default: {DB_PATH})")
    ap.add_argument("--start", type=int, default=START_YEAR, help=f"Start year (default: {START_YEAR})")
    ap.add_argument("--end", type=int, default=default_end, help=f"End year (default: {default_end})")
    ap.add_argument("--year", type=int, default=None, help="Scrape one year only")
    ap.add_argument("--delay", type=float, default=REQUEST_DELAY, help=f"Delay between requests (default: {REQUEST_DELAY})")
    args = ap.parse_args()
    run(args.db, args.start, args.end, args.delay, args.year)


if __name__ == "__main__":
    main()
