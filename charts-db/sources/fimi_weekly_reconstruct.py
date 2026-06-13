#!/usr/bin/env python3
"""
Scrape FIMI weekly Top Singoli charts and reconstruct annual charts in the
existing italy_year_end_singles.db.

This does not overwrite the official annual FIMI tables. It adds weekly source
data and reconstructed year-end rows, then v_chart selects the best available
source per year.
"""

from __future__ import annotations

import argparse
import math
import re
import sqlite3
import sys
import time
import unicodedata
from dataclasses import dataclass
from datetime import date
from html import unescape
from pathlib import Path
from typing import Optional
from urllib.parse import urljoin

import requests
from bs4 import BeautifulSoup

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from lib.common import configure_output_encoding, setup_logging


SCRIPT_DIR = Path(__file__).resolve().parent
DB_PATH = "italy_year_end_singles.db"
SCHEMA_PATH = SCRIPT_DIR.parent / "schema" / "fimi.sql"

BASE_SITE = "https://www.fimi.it"
WEEKLY_ARCHIVE_URL = f"{BASE_SITE}/top-of-the-music/archivio-classifiche-settimanali/"
WEEKLY_AJAX_URL = f"{BASE_SITE}/ajax/filter-archivio-classifiche-settimanali.php"
DEFAULT_YEARS = "1997-2001,2011"
REQUEST_DELAY = 0.35
USER_AGENT = "TuaFM FIMI weekly reconstruction scraper/1.0 (personal local script)"

SCHEMA = SCHEMA_PATH.read_text(encoding="utf-8")

ARTIST_CONNECTOR_RE = re.compile(
    r"\s+(?:feat\.?|ft\.?|featuring|with|con|vs\.?|x)\s+",
    flags=re.IGNORECASE,
)
ARTIST_SEPARATOR_RE = re.compile(r"\s*(?:,|&|\+)\s*")


configure_output_encoding()
log = setup_logging("fimi_weekly_reconstruct.log", __name__)


@dataclass(frozen=True)
class WeekRef:
    year: int
    week: int
    url: str
    period: Optional[str]


@dataclass(frozen=True)
class Entry:
    position: int
    title: str
    artist_text: str
    artists: tuple[str, ...]
    cover_url: Optional[str]
    label: Optional[str]
    distributor: Optional[str]
    weeks_on_chart: Optional[int]

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


def position_score(position: int) -> float:
    return 1.0 / math.sqrt(max(1, position))


def parse_years(value: str) -> list[int]:
    years: set[int] = set()
    for part in value.split(","):
        part = part.strip()
        if not part:
            continue
        if "-" in part:
            start_text, end_text = part.split("-", 1)
            start, end = int(start_text), int(end_text)
            if end < start:
                raise ValueError(f"Invalid year range: {part}")
            years.update(range(start, end + 1))
        else:
            years.add(int(part))
    return sorted(years)


def period_end_date(period: Optional[str], fallback_year: int) -> str:
    if period:
        match = re.search(r"Al\s+(\d{2})\.(\d{2})\.(\d{4})", period)
        if match:
            day, month, year = match.groups()
            return f"{year}-{month}-{day}"
    return f"{fallback_year}-07-01"


def build_session() -> requests.Session:
    session = requests.Session()
    session.headers.update(
        {
            "User-Agent": USER_AGENT,
            "Accept-Language": "it-IT,it;q=0.9,en;q=0.6",
            "Referer": WEEKLY_ARCHIVE_URL,
        }
    )
    return session


def request_with_retries(session: requests.Session, method: str, url: str, **kwargs) -> requests.Response:
    for attempt in range(1, 5):
        try:
            response = session.request(method, url, timeout=30, **kwargs)
            if response.status_code == 429:
                wait = min(60, 10 * attempt)
                log.warning("429 from FIMI; waiting %ss", wait)
                time.sleep(wait)
                continue
            response.raise_for_status()
            return response
        except requests.RequestException as exc:
            if attempt == 4:
                raise
            wait = min(30, 5 * attempt)
            log.warning("HTTP error %s; retrying in %ss", exc, wait)
            time.sleep(wait)
    raise RuntimeError("unreachable")


def fetch_week_refs(session: requests.Session, year: int) -> list[WeekRef]:
    response = request_with_retries(session, "POST", WEEKLY_AJAX_URL, data={"formato": 3, "year": year})
    data = response.json()
    soup = BeautifulSoup(data.get("html", ""), "lxml")
    refs: dict[int, WeekRef] = {}

    for row in soup.select("tr.row-table[data-href]"):
        href = row.get("data-href", "")
        match = re.search(r"tipo=3&anno=(\d{4})&settimana=(\d+)", href)
        if not match:
            continue
        row_year, week = int(match.group(1)), int(match.group(2))
        if row_year != year:
            continue

        spans = [clean_text(span.get_text(" ", strip=True)) for span in row.select("span.txt16.gr")]
        period = next((span for span in spans if span.lower().startswith("dal ")), None)
        refs[week] = WeekRef(year=year, week=week, url=urljoin(BASE_SITE, href), period=period)

    return [refs[week] for week in sorted(refs)]


def fetch_week_entries(session: requests.Session, ref: WeekRef) -> list[Entry]:
    response = request_with_retries(session, "GET", ref.url)
    soup = BeautifulSoup(response.text, "lxml")
    tab = soup.select_one("div#tabs-1b")
    if tab is None:
        return []

    entries: list[Entry] = []
    for row in tab.select("table.table-list tbody tr"):
        pos_span = row.select_one("span.txt28l")
        pos_text = clean_text(pos_span.get_text(" ", strip=True)) if pos_span else ""
        if not pos_text.isdigit():
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
        cover_url = urljoin(BASE_SITE, img["src"]) if img and img.get("src") else None

        label = distributor = None
        label_cell = row.find("td", attrs={"data-column": "Etichetta / Distributore"})
        if label_cell:
            label_spans = label_cell.select("span.txt16.gr")
            if len(label_spans) >= 1:
                label = clean_text(label_spans[0].get_text(" ", strip=True)) or None
            if len(label_spans) >= 2:
                distributor = clean_text(label_spans[1].get_text(" ", strip=True)) or None

        weeks_on_chart = None
        weeks_cell = row.find("td", attrs={"data-column": "Numero settimane"})
        if weeks_cell:
            weeks_text = clean_text(weeks_cell.get_text(" ", strip=True))
            if weeks_text.isdigit():
                weeks_on_chart = int(weeks_text)

        entries.append(
            Entry(
                position=int(pos_text),
                title=title,
                artist_text=artist_text,
                artists=split_artists(artist_text),
                cover_url=cover_url,
                label=label,
                distributor=distributor,
                weeks_on_chart=weeks_on_chart,
            )
        )

    return entries


class DB:
    def __init__(self, path: Path):
        self.con = sqlite3.connect(path)
        self.con.row_factory = sqlite3.Row
        self.con.executescript(SCHEMA)
        self.con.commit()
        log.info("Database: %s", path.resolve())

    def weekly_chart_exists(self, year: int, week: int) -> bool:
        return self.con.execute(
            "SELECT 1 FROM weekly_charts WHERE chart_year = ? AND chart_week = ?",
            (year, week),
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

    def upsert_weekly_chart(self, ref: WeekRef, count: int) -> int:
        self.con.execute(
            """INSERT INTO weekly_charts
               (chart_year, chart_week, chart_date, source_url, source_period, entry_count)
               VALUES (?, ?, ?, ?, ?, ?)
               ON CONFLICT(chart_year, chart_week) DO UPDATE SET
               chart_date = excluded.chart_date,
               source_url = excluded.source_url,
               source_period = excluded.source_period,
               entry_count = excluded.entry_count,
               scraped_at = datetime('now')""",
            (ref.year, ref.week, period_end_date(ref.period, ref.year), ref.url, ref.period, count),
        )
        return self.con.execute(
            "SELECT id FROM weekly_charts WHERE chart_year = ? AND chart_week = ?",
            (ref.year, ref.week),
        ).fetchone()["id"]

    def clear_weekly_entries(self, chart_id: int) -> None:
        self.con.execute("DELETE FROM weekly_entries WHERE chart_id = ?", (chart_id,))

    def insert_weekly_entry(self, chart_id: int, track_id: int, entry: Entry, source_url: str) -> None:
        self.con.execute(
            """INSERT INTO weekly_entries
               (chart_id, track_id, position, weeks_on_chart, source_title, source_artist_text,
                source_artist_list, cover_url, label, distributor, source_url)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
               ON CONFLICT(chart_id, track_id) DO UPDATE SET
               position = excluded.position,
               weeks_on_chart = excluded.weeks_on_chart,
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
                entry.position,
                entry.weeks_on_chart,
                entry.title,
                entry.artist_text,
                entry.artist_list,
                entry.cover_url,
                entry.label,
                entry.distributor,
                source_url,
            ),
        )

    def upsert_reconstructed_chart(
        self,
        year: int,
        entry_count: int,
        weeks_count: int,
        max_weekly_depth: int,
        source_period: str,
    ) -> int:
        chart_date = f"{year}-07-01"
        method = "sum(1/sqrt(position)) over FIMI weekly Top Singoli"
        self.con.execute(
            """INSERT INTO reconstructed_year_end_charts
               (chart_year, chart_date, source_title, source_url, source_period,
                entry_count, weeks_count, max_weekly_depth, method)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
               ON CONFLICT(chart_year) DO UPDATE SET
               chart_date = excluded.chart_date,
               source_title = excluded.source_title,
               source_url = excluded.source_url,
               source_period = excluded.source_period,
               entry_count = excluded.entry_count,
               weeks_count = excluded.weeks_count,
               max_weekly_depth = excluded.max_weekly_depth,
               method = excluded.method,
               scraped_at = datetime('now')""",
            (
                year,
                chart_date,
                f"FIMI reconstructed Year-End Top Singoli {year}",
                WEEKLY_ARCHIVE_URL,
                source_period,
                entry_count,
                weeks_count,
                max_weekly_depth,
                method,
            ),
        )
        return self.con.execute(
            "SELECT id FROM reconstructed_year_end_charts WHERE chart_year = ?",
            (year,),
        ).fetchone()["id"]

    def clear_reconstructed_entries(self, chart_id: int) -> None:
        self.con.execute("DELETE FROM reconstructed_year_end_entries WHERE chart_id = ?", (chart_id,))

    def insert_reconstructed_entry(self, chart_id: int, row: sqlite3.Row, rank: int) -> None:
        self.con.execute(
            """INSERT INTO reconstructed_year_end_entries
               (chart_id, track_id, rank, score, weeks_in_list, best_position,
                source_title, source_artist_text, source_artist_list, cover_url,
                label, distributor, source_url)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                chart_id,
                row["track_id"],
                rank,
                row["score"],
                row["weeks_in_list"],
                row["best_position"],
                row["source_title"],
                row["source_artist_text"],
                row["source_artist_list"],
                row["cover_url"],
                row["label"],
                row["distributor"],
                row["source_url"],
            ),
        )

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


def store_week(db: DB, ref: WeekRef, entries: list[Entry]) -> None:
    chart_id = db.upsert_weekly_chart(ref, len(entries))
    db.clear_weekly_entries(chart_id)
    for entry in entries:
        track_id = db.upsert_track(entry.title, entry.artist_key)
        for sort_order, artist_name in enumerate(entry.artists, start=1):
            artist_id = db.upsert_artist(artist_name)
            db.link_artist(track_id, artist_id, sort_order)
        db.insert_weekly_entry(chart_id, track_id, entry, ref.url)
    db.commit()


def reconstruct_year(db: DB, year: int, target_size: Optional[int]) -> int:
    weekly_rows = db.con.execute(
        """
        SELECT
            we.track_id, we.position, wc.chart_week, we.id,
            we.source_title, we.source_artist_text, we.source_artist_list,
            we.cover_url, we.label, we.distributor, we.source_url,
            t.title AS normalized_title
        FROM weekly_entries we
        JOIN weekly_charts wc ON we.chart_id = wc.id
        JOIN tracks t ON we.track_id = t.id
        WHERE wc.chart_year = ?
        ORDER BY wc.chart_week, we.position, we.id
        """,
        (year,),
    ).fetchall()
    if not weekly_rows:
        log.warning("%s: no weekly rows to reconstruct", year)
        return 0

    aggregate: dict[int, dict] = {}
    for row in weekly_rows:
        track_id = int(row["track_id"])
        item = aggregate.get(track_id)
        if item is None:
            item = {
                "track_id": track_id,
                "score": 0.0,
                "weeks_in_list": 0,
                "best_position": int(row["position"]),
                "source_title": row["source_title"],
                "source_artist_text": row["source_artist_text"],
                "source_artist_list": row["source_artist_list"],
                "cover_url": row["cover_url"],
                "label": row["label"],
                "distributor": row["distributor"],
                "source_url": row["source_url"],
                "normalized_title": row["normalized_title"],
                "best_week": int(row["chart_week"]),
                "best_order": (int(row["position"]), int(row["chart_week"]), int(row["id"])),
            }
            aggregate[track_id] = item

        position = int(row["position"])
        item["score"] += position_score(position)
        item["weeks_in_list"] += 1
        row_order = (position, int(row["chart_week"]), int(row["id"]))
        if row_order < item["best_order"]:
            item["best_position"] = position
            item["source_title"] = row["source_title"]
            item["source_artist_text"] = row["source_artist_text"]
            item["source_artist_list"] = row["source_artist_list"]
            item["cover_url"] = row["cover_url"] or item["cover_url"]
            item["label"] = row["label"] or item["label"]
            item["distributor"] = row["distributor"] or item["distributor"]
            item["source_url"] = row["source_url"]
            item["normalized_title"] = row["normalized_title"]
            item["best_week"] = int(row["chart_week"])
            item["best_order"] = row_order

    max_depth = db.con.execute(
        """
        SELECT MAX(max_pos) FROM (
            SELECT MAX(we.position) AS max_pos
            FROM weekly_entries we
            JOIN weekly_charts wc ON we.chart_id = wc.id
            WHERE wc.chart_year = ?
            GROUP BY wc.id
        )
        """,
        (year,),
    ).fetchone()[0] or 0
    weeks_count = db.con.execute(
        "SELECT COUNT(*) FROM weekly_charts WHERE chart_year = ? AND entry_count > 0",
        (year,),
    ).fetchone()[0]
    first_last = db.con.execute(
        """
        SELECT MIN(chart_week), MAX(chart_week)
        FROM weekly_charts
        WHERE chart_year = ? AND entry_count > 0
        """,
        (year,),
    ).fetchone()

    limit = min(target_size or int(max_depth), len(aggregate))
    source_period = f"FIMI weekly Top Singoli weeks {first_last[0]}-{first_last[1]} ({year})"

    enriched = list(aggregate.values())
    for item in enriched:
        item.pop("best_order", None)

    enriched.sort(
        key=lambda item: (
            -item["score"],
            item["best_position"],
            -item["weeks_in_list"],
            normalize_key(item["source_artist_list"]),
            normalize_key(item["normalized_title"]),
        )
    )

    chart_id = db.upsert_reconstructed_chart(year, limit, weeks_count, int(max_depth), source_period)
    db.clear_reconstructed_entries(chart_id)
    for rank, item in enumerate(enriched[:limit], start=1):
        db.insert_reconstructed_entry(chart_id, item, rank)
    db.log_scrape(year, "success", f"reconstructed {limit} entries from {weeks_count} weekly charts")
    db.commit()
    log.info("  reconstructed %s - %s entries from %s weekly charts", year, limit, weeks_count)
    return limit


def run(db_path: Path, years: list[int], delay: float, force: bool, target_size: Optional[int]) -> None:
    db = DB(db_path)
    session = build_session()
    scraped_weeks = skipped_weeks = empty_weeks = 0

    try:
        for year in years:
            refs = fetch_week_refs(session, year)
            log.info("%s: %s weekly Singoli refs", year, len(refs))
            if not refs:
                db.log_scrape(year, "empty", "no weekly Singoli refs")
                db.commit()
                continue

            for index, ref in enumerate(refs, start=1):
                if not force and db.weekly_chart_exists(ref.year, ref.week):
                    skipped_weeks += 1
                    continue
                entries = fetch_week_entries(session, ref)
                if entries:
                    store_week(db, ref, entries)
                    scraped_weeks += 1
                    log.info("  %s week %s/%s - %s entries", year, index, len(refs), len(entries))
                else:
                    empty_weeks += 1
                    chart_id = db.upsert_weekly_chart(ref, 0)
                    db.clear_weekly_entries(chart_id)
                    db.commit()
                    log.warning("  %s week %s/%s - empty", year, index, len(refs))
                time.sleep(delay)

            reconstruct_year(db, year, target_size)

        db.cleanup_orphans()
        db.commit()
    finally:
        db.close()

    log.info(
        "Summary: scraped_weeks=%s skipped_weeks=%s empty_weeks=%s db=%s",
        scraped_weeks,
        skipped_weeks,
        empty_weeks,
        db_path.resolve(),
    )


def main() -> None:
    parser = argparse.ArgumentParser(description="FIMI weekly Top Singoli annual reconstruction")
    parser.add_argument("--db", default=str(DB_PATH), help=f"SQLite path (default: {DB_PATH})")
    parser.add_argument("--years", default=DEFAULT_YEARS, help=f"Years/ranges to scrape (default: {DEFAULT_YEARS})")
    parser.add_argument("--delay", type=float, default=REQUEST_DELAY, help=f"Delay between week requests (default: {REQUEST_DELAY})")
    parser.add_argument("--force", action="store_true", help="Refresh weekly charts already present in the DB")
    parser.add_argument("--target-size", type=int, default=None, help="Override reconstructed year-end size")
    args = parser.parse_args()

    run(Path(args.db), parse_years(args.years), args.delay, args.force, args.target_size)


if __name__ == "__main__":
    main()
