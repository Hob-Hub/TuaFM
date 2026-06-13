#!/usr/bin/env python3
"""
Scrape SNEP/SCPP year-end Top Singles charts into SQLite.

Default range: 1994 through the previous calendar year. The scraper skips years
where SNEP exposes a filter/PDF placeholder but no rendered chart entries.
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
from urllib.parse import quote_plus, urljoin

from bs4 import BeautifulSoup

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from lib.common import build_session, configure_output_encoding, fetch_url, setup_logging


SCRIPT_DIR = Path(__file__).resolve().parent
DB_PATH = "france_year_end_singles.db"
SCHEMA_PATH = SCRIPT_DIR.parent / "schema" / "snep.sql"

START_YEAR = 1994
REQUEST_DELAY = 0.8
BASE_SITE = "https://snepmusique.com"
CATEGORY = "Top Titres Annuel"
BASE_URL = (
    f"{BASE_SITE}/les-tops/le-top-de-lannee/top-singles-annee/"
    "?annee={year}&categorie={category}"
)
PDF_URL = f"{BASE_SITE}/pdf/tops_pdf.php?annee={{year}}&categorie={{category}}"
USER_AGENT = "TuaFM SNEP Year-End scraper/1.0 (personal local script)"
ACCEPT_LANGUAGE = "fr-FR,fr;q=0.9,en;q=0.6"

SCHEMA = SCHEMA_PATH.read_text(encoding="utf-8")

ARTIST_CONNECTOR_RE = re.compile(
    r"\s+(?:feat\.?|ft\.?|featuring|avec|vs\.?|x)\s+",
    flags=re.IGNORECASE,
)
ARTIST_SEPARATOR_RE = re.compile(r"\s*(?:&|\+)\s*")


configure_output_encoding()
log = setup_logging("snep.log", __name__)


@dataclass(frozen=True)
class Entry:
    rank: int
    title: str
    artist_text: str
    artists: tuple[str, ...]
    cover_url: Optional[str]
    label: Optional[str]
    distributor: Optional[str]
    spotify_url: Optional[str]
    deezer_url: Optional[str]
    itunes_url: Optional[str]
    qobuz_url: Optional[str]
    amazon_url: Optional[str]
    fnac_url: Optional[str]

    @property
    def artist_list(self) -> str:
        return "; ".join(self.artists) if self.artists else self.artist_text

    @property
    def artist_key(self) -> str:
        return normalize_key(self.artist_list)


def normalize_key(value: str) -> str:
    s = unicodedata.normalize("NFD", value or "")
    s = "".join(ch for ch in s if unicodedata.category(ch) != "Mn")
    s = re.sub(r"[`'\u00b4\u2019\u2018]", "'", s)
    s = re.sub(r"\s+", " ", s.lower()).strip()
    return s


def clean_text(value: str) -> str:
    s = unescape(value or "")
    s = re.sub(r"\s+", " ", s).strip()
    return s


def smart_case_inverted_name(value: str) -> str:
    if value.upper() == value:
        return value.title()
    return value


def normalize_artist_part(value: str, invert_comma_names: bool) -> list[str]:
    value = clean_text(value)
    if not value:
        return []

    if value.count(",") == 1:
        left, right = [clean_text(part) for part in value.split(",", 1)]
        # Older SNEP years often use "LASTNAME, FIRSTNAME". If the left side is
        # a single token, treat it as an inverted person name; otherwise comma is
        # more likely separating two artists.
        if invert_comma_names and left and right and (" " not in left or (value.upper() == value and " " not in right)):
            return [smart_case_inverted_name(f"{right} {left}")]
        return [part for part in (left, right) if part]

    if "," in value:
        return [clean_text(part) for part in value.split(",") if clean_text(part)]

    return [value]


def split_artists(value: str, *, invert_comma_names: bool = False) -> tuple[str, ...]:
    text = clean_text(value)
    if not text:
        return tuple()

    text = ARTIST_CONNECTOR_RE.sub(";", text)
    chunks: list[str] = []
    for chunk in text.split(";"):
        chunks.extend(ARTIST_SEPARATOR_RE.split(chunk))

    parts: list[str] = []
    for chunk in chunks:
        parts.extend(normalize_artist_part(chunk, invert_comma_names))

    result: list[str] = []
    seen: set[str] = set()
    for part in parts:
        name = clean_text(part)
        key = normalize_key(name)
        if name and key and key not in seen:
            result.append(name)
            seen.add(key)
    return tuple(result) if result else (text,)


def source_url(year: int) -> str:
    return BASE_URL.format(year=year, category=quote_plus(CATEGORY))


def source_pdf_url(year: int) -> str:
    return PDF_URL.format(year=year, category=quote_plus(CATEGORY))


def parse_cover_url(item) -> Optional[str]:
    cover = item.select_one(".cover")
    style = cover.get("style", "") if cover else ""
    match = re.search(r"background\s*:\s*url\(([^)]+)\)", style)
    if not match:
        return None
    raw = match.group(1).strip("'\" ")
    return urljoin(BASE_SITE, raw)


def link_by_class(item, class_name: str) -> Optional[str]:
    link = item.select_one(f"a.{class_name}")
    href = link.get("href") if link else None
    if not href:
        return None
    href = href.strip()
    invalid_suffixes = ("/album/", "/album/id", "/gp/product/", "/a")
    if href.endswith(invalid_suffixes):
        return None
    if href in {"#", "http://www.deezer.com/album/", "http://musique.fnac.com/a"}:
        return None
    return href


def parse_entries(html: str, year: int) -> list[Entry]:
    soup = BeautifulSoup(html, "lxml")
    entries: list[Entry] = []

    for item in soup.select(".items .item"):
        rank_el = item.select_one(".rang")
        rank_text = clean_text(rank_el.get_text(" ", strip=True)) if rank_el else ""
        if not rank_text.isdigit():
            continue

        title_el = item.select_one(".description .titre")
        artist_el = item.select_one(".description .artiste")
        title = clean_text(title_el.get_text(" ", strip=True)) if title_el else ""
        artist_text = clean_text(artist_el.get_text(" ", strip=True)) if artist_el else ""
        if not title or not artist_text:
            continue

        label_el = item.select_one(".description .editeur")
        label = clean_text(label_el.get_text(" ", strip=True)) if label_el else ""

        entries.append(
            Entry(
                rank=int(rank_text),
                title=title,
                artist_text=artist_text,
                artists=split_artists(artist_text, invert_comma_names=year <= 1999),
                cover_url=parse_cover_url(item),
                label=label or None,
                distributor=None,
                spotify_url=link_by_class(item, "icon-spotify"),
                deezer_url=link_by_class(item, "icon-deezer"),
                itunes_url=link_by_class(item, "icon-itunes"),
                qobuz_url=link_by_class(item, "icon-qobuz"),
                amazon_url=link_by_class(item, "icon-amazon"),
                fnac_url=link_by_class(item, "icon-fnac"),
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
        return self.con.execute("SELECT id FROM artists WHERE name_key = ?", (key,)).fetchone()["id"]

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

    def upsert_chart(self, year: int, count: int, resolved_url: str) -> int:
        self.con.execute(
            """INSERT INTO year_end_charts
               (chart_year, chart_date, source_title, source_url, source_pdf_url,
                source_period, entry_count)
               VALUES (?, ?, ?, ?, ?, ?, ?)
               ON CONFLICT(chart_year) DO UPDATE SET
               chart_date = excluded.chart_date,
               source_title = excluded.source_title,
               source_url = excluded.source_url,
               source_pdf_url = excluded.source_pdf_url,
               source_period = excluded.source_period,
               entry_count = excluded.entry_count,
               scraped_at = datetime('now')""",
            (
                year,
                f"{year}-07-01",
                f"SNEP Top Singles Annuel {year}",
                resolved_url,
                source_pdf_url(year),
                f"01/01/{year} - 31/12/{year}",
                count,
            ),
        )
        return self.con.execute(
            "SELECT id FROM year_end_charts WHERE chart_year = ?",
            (year,),
        ).fetchone()["id"]

    def clear_chart_entries(self, chart_id: int) -> None:
        self.con.execute("DELETE FROM year_end_entries WHERE chart_id = ?", (chart_id,))

    def insert_entry(self, chart_id: int, track_id: int, entry: Entry, resolved_url: str) -> None:
        self.con.execute(
            """INSERT INTO year_end_entries
               (chart_id, track_id, rank, source_title, source_artist_text,
                source_artist_list, cover_url, label, distributor, spotify_url,
                deezer_url, itunes_url, qobuz_url, amazon_url, fnac_url, source_url)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
               ON CONFLICT(chart_id, rank, track_id) DO UPDATE SET
               source_title = excluded.source_title,
               source_artist_text = excluded.source_artist_text,
               source_artist_list = excluded.source_artist_list,
               cover_url = excluded.cover_url,
               label = excluded.label,
               distributor = excluded.distributor,
               spotify_url = excluded.spotify_url,
               deezer_url = excluded.deezer_url,
               itunes_url = excluded.itunes_url,
               qobuz_url = excluded.qobuz_url,
               amazon_url = excluded.amazon_url,
               fnac_url = excluded.fnac_url,
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
                entry.spotify_url,
                entry.deezer_url,
                entry.itunes_url,
                entry.qobuz_url,
                entry.amazon_url,
                entry.fnac_url,
                resolved_url,
            ),
        )

    def cleanup_orphans(self) -> None:
        self.con.execute(
            """DELETE FROM track_artists
               WHERE track_id IN (
                   SELECT t.id FROM tracks t
                   LEFT JOIN year_end_entries ye ON ye.track_id = t.id
                   WHERE ye.id IS NULL
               )"""
        )
        self.con.execute(
            "DELETE FROM tracks WHERE id NOT IN (SELECT DISTINCT track_id FROM year_end_entries)"
        )
        self.con.execute(
            "DELETE FROM artists WHERE id NOT IN (SELECT DISTINCT artist_id FROM track_artists)"
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


def process_year(year: int, html: str, resolved_url: str, db: DB) -> int:
    entries = parse_entries(html, year)
    if not entries:
        log.warning("%s: no rendered SNEP entries found", year)
        db.log_scrape(year, "empty", "no rendered SNEP entries")
        db.commit()
        return 0

    chart_id = db.upsert_chart(year, len(entries), resolved_url)
    db.clear_chart_entries(chart_id)

    for entry in entries:
        track_id = db.upsert_track(entry.title, entry.artist_key)
        for sort_order, artist_name in enumerate(entry.artists, start=1):
            artist_id = db.upsert_artist(artist_name)
            db.link_artist(track_id, artist_id, sort_order)
        db.insert_entry(chart_id, track_id, entry, resolved_url)

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
            html, resolved_url = fetch_url(source_url(year), session, log=log)
            if html is None:
                errors += 1
                db.log_scrape(year, "error", "HTTP fetch failed")
                db.commit()
            else:
                count = process_year(year, html, resolved_url, db)
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
    parser = argparse.ArgumentParser(description="SNEP Year-End Top Singles scraper")
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
