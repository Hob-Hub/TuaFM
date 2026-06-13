#!/usr/bin/env python3
"""
Scrape FIMI Top of the Music year-end Singoli charts into SQLite.

Default range: 2002 through the previous calendar year.
The public FIMI archive has no Singoli table for 2000-2001 in the same endpoint.
Some early years are partial lists; entry_count is stored per year.
"""

from __future__ import annotations

import argparse
import re
import sqlite3
import sys
import time
import unicodedata
from dataclasses import dataclass
from datetime import date
from html import unescape
from pathlib import Path
from typing import Iterable, Optional
from urllib.parse import urljoin

import requests
from bs4 import BeautifulSoup

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from lib.common import build_session, configure_output_encoding, fetch_url, setup_logging


SCRIPT_DIR = Path(__file__).resolve().parent
DB_PATH = "italy_year_end_singles.db"
SCHEMA_PATH = SCRIPT_DIR.parent / "schema" / "fimi.sql"

START_YEAR = 2002
REQUEST_DELAY = 1.0
BASE_URL = (
    "https://www.fimi.it/top-of-the-music/archivio-classifiche-annuali/"
    "archivio-classifiche-per-anno/?tipo=13&anno={year}"
)
ARCHIVE_URL = "https://www.fimi.it/top-of-the-music/archivio-classifiche-annuali/"
BASE_SITE = "https://www.fimi.it"
USER_AGENT = "TuaFM FIMI Year-End scraper/1.0 (personal local script)"
ACCEPT_LANGUAGE = "it-IT,it;q=0.9,en;q=0.6"

SCHEMA = SCHEMA_PATH.read_text(encoding="utf-8")

ARTIST_CONNECTOR_RE = re.compile(
    r"\s+(?:feat\.?|ft\.?|featuring|with|con|vs\.?|x)\s+",
    flags=re.IGNORECASE,
)
ARTIST_SEPARATOR_RE = re.compile(r"\s*(?:,|&|\+)\s*")


configure_output_encoding()
log = setup_logging("fimi.log", __name__)


@dataclass(frozen=True)
class Entry:
    rank: int
    title: str
    artist_text: str
    artists: tuple[str, ...]
    cover_url: Optional[str]
    label: Optional[str]
    distributor: Optional[str]

    @property
    def artist_list(self) -> str:
        return "; ".join(self.artists) if self.artists else self.artist_text

    @property
    def artist_key(self) -> str:
        return normalize_key(self.artist_list)


def normalize_key(value: str) -> str:
    s = unicodedata.normalize("NFD", value or "")
    s = "".join(ch for ch in s if unicodedata.category(ch) != "Mn")
    s = re.sub(r"[`´’‘]", "'", s)
    s = re.sub(r"\s+", " ", s.lower()).strip()
    return s


def clean_text(value: str) -> str:
    s = unescape(value or "")
    s = re.sub(r"\s+", " ", s).strip()
    return s


def split_artists(value: str) -> tuple[str, ...]:
    text = clean_text(value)
    if not text:
        return tuple()

    text = ARTIST_CONNECTOR_RE.sub(";", text)
    parts: list[str] = []
    for chunk in text.split(";"):
        parts.extend(ARTIST_SEPARATOR_RE.split(chunk))

    result: list[str] = []
    seen: set[str] = set()
    for part in parts:
        name = clean_text(part)
        key = normalize_key(name)
        if name and key and key not in seen:
            result.append(name)
            seen.add(key)
    return tuple(result) if result else (text,)


def fetch_year_periods(session: requests.Session) -> dict[int, str]:
    try:
        response = session.get(ARCHIVE_URL, timeout=30)
        response.raise_for_status()
    except requests.RequestException as exc:
        log.warning("Could not fetch FIMI annual archive periods: %s", exc)
        return {}

    soup = BeautifulSoup(response.text, "lxml")
    periods: dict[int, str] = {}
    for row in soup.select('tr.row-table[data-href*="tipo=13"]'):
        href = row.get("data-href", "")
        match = re.search(r"anno=(\d{4})", href)
        if not match:
            continue
        year = int(match.group(1))
        spans = [clean_text(span.get_text(" ", strip=True)) for span in row.select("span.txt16.gr")]
        period = next((span for span in spans if span.lower().startswith("dal ")), "")
        if period:
            periods[year] = period
    log.info("Loaded FIMI annual periods for %s Singoli years", len(periods))
    return periods


def parse_entries(html: str) -> list[Entry]:
    soup = BeautifulSoup(html, "lxml")
    tab = soup.select_one("div#tabs1b")
    if tab is None:
        return []

    entries: list[Entry] = []
    for row in tab.select("table.table-list tbody tr"):
        rank_span = row.select_one("span.txt28l")
        rank_text = clean_text(rank_span.get_text(" ", strip=True)) if rank_span else ""
        if not rank_text.isdigit():
            continue

        title_cell = row.find("td", attrs={"data-column": "Titolo Artista"})
        if title_cell is None:
            continue

        title_span = title_cell.select_one("span.txt22")
        artist_span = title_cell.select_one("span.txt18.gr")
        title = clean_text(title_span.get_text(" ", strip=True)) if title_span else ""
        artist_text = clean_text(artist_span.get_text(" ", strip=True)) if artist_span else ""
        if not title or not artist_text:
            continue

        img = row.select_one("td.chart-image img")
        cover_url = None
        if img and img.get("src"):
            cover_url = urljoin(BASE_SITE, img["src"])

        label_cell = row.find("td", attrs={"data-column": "Etichetta / Distributore"})
        label = distributor = None
        if label_cell:
            label_spans = label_cell.select("span.txt16.gr")
            if len(label_spans) >= 1:
                label = clean_text(label_spans[0].get_text(" ", strip=True)) or None
            if len(label_spans) >= 2:
                distributor = clean_text(label_spans[1].get_text(" ", strip=True)) or None

        entries.append(
            Entry(
                rank=int(rank_text),
                title=title,
                artist_text=artist_text,
                artists=split_artists(artist_text),
                cover_url=cover_url,
                label=label,
                distributor=distributor,
            )
        )

    entries.sort(key=lambda e: e.rank)
    return entries


class DB:
    def __init__(self, path: Path):
        path.parent.mkdir(parents=True, exist_ok=True)
        self.con = sqlite3.connect(path)
        self.con.row_factory = sqlite3.Row
        self.con.executescript(SCHEMA)
        self.con.commit()
        log.info("Database: %s", path.resolve())

    def chart_exists(self, year: int) -> bool:
        return self.con.execute(
            "SELECT 1 FROM year_end_charts WHERE chart_year = ?",
            (year,),
        ).fetchone() is not None

    def upsert_artist(self, name: str) -> int:
        key = normalize_key(name)
        self.con.execute(
            """INSERT INTO artists (name, name_key)
               VALUES (?, ?)
               ON CONFLICT(name_key) DO UPDATE SET name = excluded.name""",
            (name, key),
        )
        return self.con.execute(
            "SELECT id FROM artists WHERE name_key = ?",
            (key,),
        ).fetchone()["id"]

    def upsert_track(self, title: str, artist_key: str) -> int:
        title_key = normalize_key(title)
        self.con.execute(
            """INSERT INTO tracks (title, title_key, artist_key)
               VALUES (?, ?, ?)
               ON CONFLICT(title_key, artist_key) DO UPDATE SET title = excluded.title""",
            (title, title_key, artist_key),
        )
        return self.con.execute(
            "SELECT id FROM tracks WHERE title_key = ? AND artist_key = ?",
            (title_key, artist_key),
        ).fetchone()["id"]

    def link_artist(self, track_id: int, artist_id: int, sort_order: int) -> None:
        self.con.execute(
            """INSERT OR IGNORE INTO track_artists (track_id, artist_id, sort_order)
               VALUES (?, ?, ?)""",
            (track_id, artist_id, sort_order),
        )

    def upsert_chart(self, year: int, source_url: str, source_period: Optional[str], count: int) -> int:
        chart_date = f"{year}-07-01"
        self.con.execute(
            """INSERT INTO year_end_charts
               (chart_year, chart_date, source_title, source_url, source_period, entry_count)
               VALUES (?, ?, ?, ?, ?, ?)
               ON CONFLICT(chart_year) DO UPDATE SET
               chart_date = excluded.chart_date,
               source_title = excluded.source_title,
               source_url = excluded.source_url,
               source_period = excluded.source_period,
               entry_count = excluded.entry_count,
               scraped_at = datetime('now')""",
            (year, chart_date, f"FIMI Year-End Top Singoli {year}", source_url, source_period, count),
        )
        return self.con.execute(
            "SELECT id FROM year_end_charts WHERE chart_year = ?",
            (year,),
        ).fetchone()["id"]

    def clear_chart_entries(self, chart_id: int) -> None:
        self.con.execute("DELETE FROM year_end_entries WHERE chart_id = ?", (chart_id,))

    def cleanup_orphans(self) -> None:
        self.con.execute(
            """DELETE FROM track_artists
               WHERE track_id IN (
                   SELECT t.id FROM tracks t
                   LEFT JOIN year_end_entries ye ON ye.track_id = t.id
                   LEFT JOIN weekly_entries we ON we.track_id = t.id
                   LEFT JOIN reconstructed_year_end_entries rye ON rye.track_id = t.id
                   WHERE ye.id IS NULL
                     AND we.id IS NULL
                     AND rye.id IS NULL
               )"""
        )
        self.con.execute(
            """DELETE FROM tracks
               WHERE id NOT IN (
                   SELECT DISTINCT track_id FROM year_end_entries
                   UNION
                   SELECT DISTINCT track_id FROM weekly_entries
                   UNION
                   SELECT DISTINCT track_id FROM reconstructed_year_end_entries
               )"""
        )
        self.con.execute(
            """DELETE FROM artists
               WHERE id NOT IN (SELECT DISTINCT artist_id FROM track_artists)"""
        )

    def insert_entry(self, chart_id: int, track_id: int, entry: Entry, source_url: str) -> None:
        self.con.execute(
            """INSERT INTO year_end_entries
               (chart_id, track_id, rank, source_title, source_artist_text,
                source_artist_list, cover_url, label, distributor, source_url)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
               ON CONFLICT(chart_id, rank, track_id) DO UPDATE SET
               source_title = excluded.source_title,
               source_artist_text = excluded.source_artist_text,
               source_artist_list = excluded.source_artist_list,
               cover_url = excluded.cover_url,
               label = excluded.label,
               distributor = excluded.distributor,
               source_url = excluded.source_url""",
            (
                chart_id,
                track_id,
                entry.rank,
                entry.title,
                entry.artist_text,
                entry.artist_list,
                entry.cover_url,
                entry.label,
                entry.distributor,
                source_url,
            ),
        )

    def log_scrape(self, year: int, status: str, message: str = "") -> None:
        self.con.execute(
            "INSERT INTO scrape_log (chart_year, status, message) VALUES (?, ?, ?)",
            (year, status, message),
        )

    def commit(self) -> None:
        self.con.commit()

    def close(self) -> None:
        self.con.close()


def process_year(year: int, html: str, source_url: str, source_period: Optional[str], db: DB) -> int:
    entries = parse_entries(html)
    if not entries:
        log.warning("%s: no Singoli entries found", year)
        db.log_scrape(year, "empty", "no Singoli entries")
        db.commit()
        return 0

    chart_id = db.upsert_chart(year, source_url, source_period, len(entries))
    db.clear_chart_entries(chart_id)

    for entry in entries:
        track_id = db.upsert_track(entry.title, entry.artist_key)
        for sort_order, artist_name in enumerate(entry.artists, start=1):
            artist_id = db.upsert_artist(artist_name)
            db.link_artist(track_id, artist_id, sort_order)
        db.insert_entry(chart_id, track_id, entry, source_url)

    db.cleanup_orphans()
    db.log_scrape(year, "success", f"{len(entries)} entries")
    db.commit()
    log.info("  ok %s - %s entries", year, len(entries))
    return len(entries)


def year_range(start: int, end: int, single_year: Optional[int]) -> Iterable[int]:
    if single_year is not None:
        return [single_year]
    if end < start:
        raise ValueError("--end cannot be smaller than --start")
    return range(start, end + 1)


def run(db_path: Path, start_year: int, end_year: int, delay: float, single_year: Optional[int], force: bool) -> None:
    db = DB(db_path)
    session = build_session(USER_AGENT, ACCEPT_LANGUAGE)
    years = list(year_range(start_year, end_year, single_year))
    periods = fetch_year_periods(session)
    scraped = skipped = empty = errors = 0

    log.info("Scraping %s year(s): %s -> %s", len(years), years[0], years[-1])
    try:
        for index, year in enumerate(years, start=1):
            if not force and single_year is None and db.chart_exists(year):
                skipped += 1
                db.log_scrape(year, "skip", "already present")
                db.commit()
                continue

            log.info("[%s/%s] %s", index, len(years), year)
            html, source_url = fetch_url(BASE_URL.format(year=year), session, log=log)
            if html is None:
                errors += 1
                db.log_scrape(year, "error", "HTTP fetch failed")
                db.commit()
            else:
                count = process_year(year, html, source_url, periods.get(year), db)
                if count:
                    scraped += 1
                else:
                    empty += 1
            time.sleep(delay)
    finally:
        db.close()

    log.info(
        "Summary: scraped=%s skipped=%s empty=%s errors=%s db=%s",
        scraped,
        skipped,
        empty,
        errors,
        db_path.resolve(),
    )


def main() -> None:
    default_end = date.today().year - 1
    parser = argparse.ArgumentParser(description="FIMI Year-End Top Singoli scraper")
    parser.add_argument("--db", default=str(DB_PATH), help=f"SQLite path (default: {DB_PATH})")
    parser.add_argument("--start", type=int, default=START_YEAR, help=f"Start year (default: {START_YEAR})")
    parser.add_argument("--end", type=int, default=default_end, help=f"End year (default: {default_end})")
    parser.add_argument("--year", type=int, default=None, help="Scrape one year only")
    parser.add_argument("--delay", type=float, default=REQUEST_DELAY, help=f"Delay between requests (default: {REQUEST_DELAY})")
    parser.add_argument("--force", action="store_true", help="Refresh years already present in the DB")
    args = parser.parse_args()

    run(Path(args.db), args.start, args.end, args.delay, args.year, args.force)


if __name__ == "__main__":
    main()
