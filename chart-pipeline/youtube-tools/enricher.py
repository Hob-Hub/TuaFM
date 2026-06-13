#!/usr/bin/env python3
"""
Fill missing youtubeVideoId values in public/catalog/tracks.json.

Default mode is safe: it reports what would be updated, but does not write the
catalog unless --apply is passed.

Providers:
  api    Uses YouTube Data API search.list. Requires YOUTUBE_API_KEY or
         VITE_YOUTUBE_API_KEY. This is the official path, but search.list costs
         quota per track.
  yt-dlp Uses yt-dlp search metadata if the package/CLI is installed.
  auto   Tries API first, then yt-dlp.
"""

from __future__ import annotations

import argparse
import csv
import json
import os
import re
import shutil
import sqlite3
import subprocess
import sys
import time
import unicodedata
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import requests


HERE = Path(__file__).resolve().parent
OUT = HERE / "out"
ROOT = Path(__file__).resolve().parents[2]
DEFAULT_CATALOG = ROOT / "public" / "catalog" / "tracks.json"
DEFAULT_CHARTS_DIR = ROOT / "public" / "charts"
DEFAULT_OVERRIDES = HERE.parent / "overrides.json"
DEFAULT_CACHE = OUT / ".youtube-catalog-cache.db"
DEFAULT_REPORT = OUT / "enrichment_report.json"
DEFAULT_MISSING_CSV = OUT / "missing.csv"

YOUTUBE_SEARCH_URL = "https://www.googleapis.com/youtube/v3/search"
NOEMBED_URL = "https://noembed.com/embed"
VIDEO_ID_RE = re.compile(r"^[A-Za-z0-9_-]{11}$")


@dataclass
class Candidate:
    video_id: str
    title: str
    channel: str
    score: float
    source_rank: int
    provider: str
    valid: bool | None = None
    validation_reason: str | None = None

    def as_dict(self) -> dict[str, Any]:
        return {
            "videoId": self.video_id,
            "title": self.title,
            "channel": self.channel,
            "score": self.score,
            "sourceRank": self.source_rank,
            "provider": self.provider,
            "valid": self.valid,
            "validationReason": self.validation_reason,
        }


def utc_now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def normalize(text: str) -> str:
    value = unicodedata.normalize("NFD", str(text or ""))
    value = "".join(ch for ch in value if unicodedata.category(ch) != "Mn")
    value = value.lower()
    value = re.sub(r"[^a-z0-9]+", " ", value)
    return re.sub(r"\s+", " ", value).strip()


def significant_tokens(text: str) -> list[str]:
    stop = {
        "a", "an", "and", "by", "con", "de", "del", "el", "en", "feat",
        "featuring", "ft", "la", "las", "le", "los", "of", "official",
        "the", "to", "un", "una", "version", "video", "with", "y",
    }
    return [t for t in normalize(text).split() if len(t) > 1 and t not in stop]


def compact(text: str) -> str:
    value = str(text or "").replace("!", "i").replace("$", "s").replace("@", "a")
    return re.sub(r"[^a-z0-9]+", "", normalize(value))


def primary_artist(artist: str) -> str:
    return re.split(r",|;| feat\.? | ft\.? | & ", str(artist or ""), maxsplit=1, flags=re.I)[0].strip()


def primary_artist_for_track(track: dict[str, Any]) -> str:
    key = str(track.get("key") or "")
    if "::" in key:
        artist_key = key.split("::", 1)[0].strip()
        if artist_key:
            return artist_key
    return primary_artist(track.get("artist", ""))


def query_for_track(track: dict[str, Any]) -> str:
    artist = primary_artist_for_track(track) or track.get("artist", "")
    title = str(track.get("title", "")).strip()
    return f"{artist} {title}".strip()


def score_candidate(raw: dict[str, str], track: dict[str, Any], rank: int, provider: str) -> Candidate | None:
    video_id = raw.get("video_id", "")
    if not VIDEO_ID_RE.match(video_id):
        return None

    title = raw.get("title", "") or ""
    channel = raw.get("channel", "") or ""
    candidate_text = f"{title} {channel}"
    haystack = normalize(candidate_text)
    candidate_compact = compact(candidate_text)
    candidate_title_compact = compact(title)
    title_norm = normalize(track.get("title", ""))
    title_core_norm = normalize(re.sub(r"[\[(].*?[\])]", "", str(track.get("title", ""))))
    title_compact = compact(track.get("title", ""))
    primary = primary_artist_for_track(track)
    artist_norm = normalize(primary)
    artist_compact = compact(primary)
    full_artist_norm = normalize(track.get("artist", ""))
    title_tokens = significant_tokens(track.get("title", ""))
    channel_norm = normalize(channel)
    channel_compact = compact(channel)
    primary_artist_match = bool(
        (artist_norm and artist_norm in haystack)
        or (artist_compact and artist_compact in candidate_compact)
    )

    score = 0.0
    if title_norm and title_norm in haystack:
        score += 5
    elif title_compact and len(title_compact) > 2 and title_compact in candidate_title_compact:
        score += 5
    elif title_core_norm and title_core_norm != title_norm and title_core_norm in haystack:
        score += 2.5
    if title_tokens:
        token_hits = sum(1 for token in title_tokens if token in haystack)
        score += 3 * (token_hits / len(title_tokens))
        if token_hits == len(title_tokens):
            score += 2
    if primary_artist_match:
        score += 4
    elif full_artist_norm and any(len(part) > 2 and part in haystack for part in full_artist_norm.split()):
        score += 1

    title_l = title.lower()
    channel_l = channel.lower()
    trusted_channel = False
    if artist_norm and channel_norm == artist_norm:
        trusted_channel = True
        score += 3
    elif artist_compact and channel_compact == artist_compact:
        trusted_channel = True
        score += 3
    elif artist_compact and channel_compact.startswith(artist_compact) and channel_compact[len(artist_compact):] in {
        "music",
        "tv",
        "video",
        "videos",
    }:
        trusted_channel = True
        score += 2.5
    elif artist_compact and artist_compact in channel_compact and (
        "vevo" in channel_compact or "official" in channel_l or "topic" in channel_l
    ):
        trusted_channel = True
        score += 3
    elif channel_l.endswith("topic") and artist_compact and artist_compact in channel_compact:
        trusted_channel = True
        score += 2

    if re.search(r"official\s*(music\s*)?video", title_l) or "videoclip" in title_l:
        score += 2.5 if trusted_channel else 1
    elif re.search(r"official\s*audio", title_l):
        score += 1 if trusted_channel else 0.25
    if "official" in channel_l or "vevo" in channel_l or channel_l.endswith("topic"):
        score += 2
    if "lyric" in title_l and trusted_channel:
        score += 0.75
    if trusted_channel and title_compact and len(title_compact) > 2 and title_compact in candidate_title_compact:
        score += 1
    if (
        trusted_channel
        and title_core_norm
        and title_core_norm != title_norm
        and title_core_norm in normalize(title)
        and re.search(r"official\s*(music\s*)?video", title_l)
    ):
        score += 1.5
    suffix_text = " ".join(re.findall(r"[\[(](.*?)[\])]", title_l))
    title_without_suffix = re.sub(r"[\[(].*?[\])]", "", title)
    title_without_suffix_norm = normalize(title_without_suffix)
    if (
        trusted_channel
        and title_norm
        and title_norm in title_without_suffix_norm
        and not re.search(r"\b(audio|lyric|lyrics|live|session|sessions|acoustic|remix)\b", suffix_text)
    ):
        score += 1.5

    title_requested = normalize(track.get("title", ""))
    candidate_title_norm = normalize(title)
    if re.search(r"\b(no rap|without rap|sin rap|solo version)\b", title_requested) and not re.search(
        r"\b(no rap|without rap|sin rap|solo version|no jay|without jay)\b",
        candidate_title_norm,
    ):
        score -= 6
    if "remix" in title_requested:
        if "remix" in candidate_title_norm:
            score += 0.75
        else:
            score -= 5
    if "murder" in title_requested and "murder" in candidate_title_norm:
        score += 0.5
    penalties = [
        (
            r"[\u3040-\u30ff\u3400-\u9fff\uac00-\ud7af]",
            4 if not re.search(r"[\u3040-\u30ff\u3400-\u9fff\uac00-\ud7af]", str(track.get("title", ""))) else 0,
        ),
        (r"\b(unofficial|fan\s*made|fanmade)\b", 5),
        (r"\b(the voice|x factor|got talent|audition|performance)\b", 5),
        (r"\b(behind the scenes|making of)\b", 8),
        (r"\bin the style of\b", 8),
        (r"\binstrumental\b", 8 if "instrumental" not in title_requested else 0),
        (r"\b(cover|karaoke|tribute|reaction|tutorial|8d|nightcore|sped up|slowed)\b", 5),
        (r"\b(a\s*cappella|acapella|remaster|remastered)\b", 4),
        (r"\b(full album|album completo|playlist)\b", 4),
        (r"\bremix\b", 3 if "remix" not in title_requested else 0),
        (r"\b(12\s*\"?\s*mix|club mix|dance mix|extended mix)\b", 4 if not re.search(r"\b(mix|remix)\b", title_requested) else 0),
        (
            r"\b(live|directo|concert|concierto|session|sessions|actuacion|actuación|tv|tve)\b",
            4 if not re.search(r"\b(live|directo|session|actuacion|actuación)\b", title_requested) else 0,
        ),
        (
            r"\b(acoustic|acustico|acústico)\b",
            8 if not re.search(r"\b(acoustic|acustico|acústico)\b", title_requested) else 0,
        ),
        (
            r"\b(orchestral|orchestra|piano|vocal version|radio edit|unplugged|extended|netflix|series|soundtrack|queen charlotte)\b",
            4 if not re.search(r"\b(orchestral|orchestra|piano|radio edit|unplugged|extended|soundtrack)\b", title_requested) else 0,
        ),
        (
            r"\b(arr\.?|arranged|arrangement|tribute band|marching band|wind band)\b",
            5 if not re.search(r"\b(arr\.?|arranged|arrangement)\b", title_requested) else 0,
        ),
    ]
    for pattern, penalty in penalties:
        if penalty and re.search(pattern, title_l):
            score -= penalty

    if "unofficial" in channel_l:
        score -= 8

    if len(title_tokens) <= 1 and not primary_artist_match and not trusted_channel:
        score -= 5
    if len(title_tokens) <= 1 and primary_artist_match and not trusted_channel:
        lead = re.split(r"\s+[-–—|]\s+", title, maxsplit=1)[0]
        lead_norm = normalize(lead)
        if lead_norm and title_norm not in lead_norm and artist_norm and not lead_norm.startswith(artist_norm):
            score -= 4

    # Keep the API/yt-dlp order as a small tie breaker without overwhelming text match.
    score -= rank * 0.05
    return Candidate(video_id, title, channel, round(score, 3), rank, provider)


class YoutubeCatalogEnricher:
    def __init__(self, args: argparse.Namespace) -> None:
        self.args = args
        self.cache = sqlite3.connect(args.cache)
        self.cache.row_factory = sqlite3.Row
        self.session = requests.Session()
        self.api_available: bool | None = None
        self.ytdlp_available: bool | None = None
        self.stats = {
            "cache_hits": 0,
            "api_calls": 0,
            "ytdlp_calls": 0,
            "validated": 0,
            "provider_errors": 0,
        }
        self._init_cache()

    def close(self) -> None:
        self.cache.close()

    def _init_cache(self) -> None:
        self.cache.executescript(
            """
            CREATE TABLE IF NOT EXISTS youtube_search_cache (
              provider TEXT NOT NULL,
              track_key TEXT NOT NULL,
              query TEXT NOT NULL,
              status TEXT NOT NULL,
              candidates_json TEXT NOT NULL,
              error TEXT,
              fetched_at TEXT NOT NULL,
              PRIMARY KEY (provider, track_key)
            );
            CREATE TABLE IF NOT EXISTS youtube_video_validation (
              video_id TEXT PRIMARY KEY,
              ok INTEGER NOT NULL,
              status_code INTEGER,
              reason TEXT,
              title TEXT,
              author_name TEXT,
              fetched_at TEXT NOT NULL
            );
            """
        )
        self.cache.commit()

    def read_api_key(self) -> str:
        for name in ("YOUTUBE_API_KEY", "VITE_YOUTUBE_API_KEY"):
            value = os.environ.get(name)
            if value:
                return value.strip().strip("'\"")

        env_path = ROOT / ".env.local"
        if env_path.exists():
            text = env_path.read_text(encoding="utf-8")
            for name in ("YOUTUBE_API_KEY", "VITE_YOUTUBE_API_KEY"):
                match = re.search(rf"^\s*{re.escape(name)}\s*=\s*(.+?)\s*$", text, re.M)
                if match:
                    return match.group(1).strip().strip("'\"")
        return ""

    def provider_sequence(self) -> list[str]:
        if self.args.source == "auto":
            return ["api", "yt-dlp"]
        if self.args.source == "cache-only":
            return ["yt-dlp", "api"]
        return [self.args.source]

    def get_cached_search(self, provider: str, track_key: str) -> tuple[str, list[dict[str, Any]], str | None] | None:
        if self.args.force:
            return None
        row = self.cache.execute(
            "SELECT status, candidates_json, error FROM youtube_search_cache WHERE provider = ? AND track_key = ?",
            (provider, track_key),
        ).fetchone()
        if not row:
            return None
        self.stats["cache_hits"] += 1
        return row["status"], json.loads(row["candidates_json"]), row["error"]

    def put_cached_search(
        self,
        provider: str,
        track_key: str,
        query: str,
        status: str,
        candidates: list[Candidate],
        error: str | None = None,
    ) -> None:
        self.cache.execute(
            """
            INSERT OR REPLACE INTO youtube_search_cache
              (provider, track_key, query, status, candidates_json, error, fetched_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            (
                provider,
                track_key,
                query,
                status,
                json.dumps([c.as_dict() for c in candidates], ensure_ascii=False),
                error,
                utc_now(),
            ),
        )
        self.cache.commit()

    def validate_video(self, candidate: Candidate) -> Candidate:
        if self.args.no_validate:
            candidate.valid = True
            return candidate

        row = self.cache.execute(
            "SELECT ok, reason FROM youtube_video_validation WHERE video_id = ?",
            (candidate.video_id,),
        ).fetchone()
        if row and not self.args.force_validation:
            candidate.valid = bool(row["ok"])
            candidate.validation_reason = row["reason"]
            return candidate

        self.stats["validated"] += 1
        try:
            res = self.session.get(
                NOEMBED_URL,
                params={"url": f"https://www.youtube.com/watch?v={candidate.video_id}"},
                timeout=15,
            )
            status_code = res.status_code
            data = res.json() if res.text else {}
            reason = data.get("error")
            ok = status_code == 200 and not reason
            title = data.get("title")
            author_name = data.get("author_name")
        except Exception as exc:  # noqa: BLE001 - cache the concrete failure.
            status_code = None
            reason = f"{type(exc).__name__}: {exc}"
            ok = False
            title = None
            author_name = None

        self.cache.execute(
            """
            INSERT OR REPLACE INTO youtube_video_validation
              (video_id, ok, status_code, reason, title, author_name, fetched_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            (candidate.video_id, int(ok), status_code, reason, title, author_name, utc_now()),
        )
        self.cache.commit()
        candidate.valid = ok
        candidate.validation_reason = reason
        return candidate

    def search_api(self, track: dict[str, Any], query: str) -> tuple[str, list[Candidate], str | None]:
        key = self.read_api_key()
        if not key:
            return "error", [], "YOUTUBE_API_KEY/VITE_YOUTUBE_API_KEY not configured"

        params = {
            "part": "snippet",
            "q": query,
            "type": "video",
            "videoEmbeddable": "true",
            "maxResults": str(self.args.max_results),
            "key": key,
        }
        self.stats["api_calls"] += 1
        try:
            res = self.session.get(YOUTUBE_SEARCH_URL, params=params, timeout=20)
            data = res.json()
        except Exception as exc:  # noqa: BLE001
            return "error", [], f"{type(exc).__name__}: {exc}"

        if not res.ok or data.get("error"):
            error = data.get("error") or {"code": res.status_code, "message": res.text[:200]}
            return "error", [], json.dumps(error, ensure_ascii=False)

        candidates: list[Candidate] = []
        for i, item in enumerate(data.get("items") or []):
            raw = {
                "video_id": item.get("id", {}).get("videoId", ""),
                "title": item.get("snippet", {}).get("title", ""),
                "channel": item.get("snippet", {}).get("channelTitle", ""),
            }
            cand = score_candidate(raw, track, i, "api")
            if cand:
                candidates.append(cand)
        return ("ok" if candidates else "no_results"), candidates, None

    def search_ytdlp_module(self, track: dict[str, Any], query: str) -> tuple[str, list[Candidate], str | None]:
        try:
            from yt_dlp import YoutubeDL  # type: ignore
        except Exception as exc:  # noqa: BLE001
            return "error", [], f"yt-dlp module unavailable: {exc}"

        self.stats["ytdlp_calls"] += 1
        opts = {
            "quiet": True,
            "no_warnings": True,
            "skip_download": True,
            "extract_flat": "in_playlist",
            "ignoreerrors": True,
            "extractor_args": {"youtube": {"player_client": "web_safari"}},
        }
        if self.args.official_only_query:
            queries = [f"{query} official music video", f"{query} official audio"]
        else:
            queries = [query]
        if not self.args.no_official_query and not self.args.official_only_query:
            queries.append(f"{query} official music video")
            queries.append(f"{query} official audio")

        seen: set[str] = set()
        candidates: list[Candidate] = []
        try:
            with YoutubeDL(opts) as ydl:
                for query_index, query_variant in enumerate(queries):
                    info = ydl.extract_info(f"ytsearch{self.args.max_results}:{query_variant}", download=False)
                    entries = (info or {}).get("entries") or []
                    for i, item in enumerate(entries):
                        if not item:
                            continue
                        video_id = item.get("id", "")
                        if video_id in seen:
                            continue
                        seen.add(video_id)
                        raw = {
                            "video_id": video_id,
                            "title": item.get("title", ""),
                            "channel": item.get("channel") or item.get("uploader") or "",
                        }
                        cand = score_candidate(raw, track, query_index * self.args.max_results + i, "yt-dlp")
                        if cand:
                            candidates.append(cand)
        except Exception as exc:  # noqa: BLE001
            return "error", [], f"{type(exc).__name__}: {exc}"

        return ("ok" if candidates else "no_results"), candidates, None

    def search_ytdlp_cli(self, track: dict[str, Any], query: str) -> tuple[str, list[Candidate], str | None]:
        exe = shutil.which("yt-dlp")
        if not exe:
            return "error", [], "yt-dlp CLI unavailable"

        self.stats["ytdlp_calls"] += 1
        if self.args.official_only_query:
            queries = [f"{query} official music video", f"{query} official audio"]
        else:
            queries = [query]
        if not self.args.no_official_query and not self.args.official_only_query:
            queries.append(f"{query} official music video")
            queries.append(f"{query} official audio")
        seen: set[str] = set()
        candidates: list[Candidate] = []
        for query_index, query_variant in enumerate(queries):
            cmd = [
                exe,
                "--quiet",
                "--no-warnings",
                "--skip-download",
                "--flat-playlist",
                "--extractor-args",
                "youtube:player_client=web_safari",
                "--dump-json",
                f"ytsearch{self.args.max_results}:{query_variant}",
            ]
            try:
                proc = subprocess.run(cmd, text=True, capture_output=True, timeout=60, check=False)
            except Exception as exc:  # noqa: BLE001
                return "error", [], f"{type(exc).__name__}: {exc}"

            if proc.returncode != 0:
                return "error", [], proc.stderr.strip()[:1000] or f"yt-dlp exit {proc.returncode}"

            for i, line in enumerate(proc.stdout.splitlines()):
                try:
                    item = json.loads(line)
                except json.JSONDecodeError:
                    continue
                video_id = item.get("id", "")
                if video_id in seen:
                    continue
                seen.add(video_id)
                raw = {
                    "video_id": video_id,
                    "title": item.get("title", ""),
                    "channel": item.get("channel") or item.get("uploader") or "",
                }
                cand = score_candidate(raw, track, query_index * self.args.max_results + i, "yt-dlp")
                if cand:
                    candidates.append(cand)
        return ("ok" if candidates else "no_results"), candidates, None

    def search_ytdlp(self, track: dict[str, Any], query: str) -> tuple[str, list[Candidate], str | None]:
        status, candidates, error = self.search_ytdlp_module(track, query)
        if status != "error" or "module unavailable" not in (error or ""):
            return status, candidates, error
        return self.search_ytdlp_cli(track, query)

    def search_provider(self, provider: str, track: dict[str, Any], query: str) -> tuple[str, list[Candidate], str | None]:
        cached = self.get_cached_search(provider, track["key"])
        if cached:
            status, cached_candidates, error = cached
            candidates = []
            for c in cached_candidates:
                rank = int(c.get("sourceRank", 0))
                rescored = score_candidate(
                    {
                        "video_id": c.get("videoId", ""),
                        "title": c.get("title", ""),
                        "channel": c.get("channel", ""),
                    },
                    track,
                    rank,
                    c.get("provider", provider),
                )
                if rescored:
                    rescored.valid = c.get("valid")
                    rescored.validation_reason = c.get("validationReason")
                    candidates.append(rescored)
            return status, candidates, error

        if self.args.source == "cache-only":
            return "no_results", [], None

        if provider == "api":
            status, candidates, error = self.search_api(track, query)
        elif provider == "yt-dlp":
            status, candidates, error = self.search_ytdlp(track, query)
        else:
            return "error", [], f"unknown provider: {provider}"

        if status == "error":
            self.stats["provider_errors"] += 1
        self.put_cached_search(provider, track["key"], query, status, candidates, error)
        return status, candidates, error

    def choose_candidate(self, track: dict[str, Any]) -> tuple[Candidate | None, list[Candidate], list[dict[str, Any]]]:
        query = query_for_track(track)
        provider_errors: list[dict[str, Any]] = []
        all_candidates: list[Candidate] = []

        for provider in self.provider_sequence():
            status, candidates, error = self.search_provider(provider, track, query)
            if status == "error":
                provider_errors.append({"provider": provider, "error": error})
                continue
            all_candidates.extend(candidates)
            if candidates:
                break

        all_candidates.sort(key=lambda c: (-c.score, c.source_rank))
        for candidate in all_candidates:
            if candidate.score < self.args.min_score:
                continue
            self.validate_video(candidate)
            if candidate.valid:
                return candidate, all_candidates, provider_errors

        return None, all_candidates, provider_errors


def load_catalog(path: Path) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    data = json.loads(path.read_text(encoding="utf-8"))
    tracks = data.get("tracks")
    if not isinstance(tracks, list):
        raise ValueError(f"{path} does not contain a tracks array")
    return data, tracks


def load_usage(charts_dir: Path) -> dict[int, dict[str, Any]]:
    usage: dict[int, dict[str, Any]] = {}
    for path in sorted(charts_dir.glob("*.json")):
        if path.name == "registry.json":
            continue
        chart = json.loads(path.read_text(encoding="utf-8"))
        chart_id = chart.get("chartId") or path.stem
        for period in chart.get("periods", []):
            year = period.get("year")
            for song in period.get("songs", []):
                track_id = song.get("t")
                if not isinstance(track_id, int):
                    continue
                row = usage.setdefault(
                    track_id,
                    {"chartIds": set(), "years": set(), "bestRank": 9999, "uses": 0},
                )
                row["chartIds"].add(chart_id)
                if isinstance(year, int):
                    row["years"].add(year)
                rank = song.get("r")
                if isinstance(rank, int):
                    row["bestRank"] = min(row["bestRank"], rank)
                row["uses"] += 1

    result: dict[int, dict[str, Any]] = {}
    for track_id, row in usage.items():
        result[track_id] = {
            "chartIds": sorted(row["chartIds"]),
            "years": sorted(row["years"]),
            "bestRank": row["bestRank"],
            "uses": row["uses"],
        }
    return result


def has_good_video_id(track: dict[str, Any]) -> bool:
    value = track.get("youtubeVideoId")
    return isinstance(value, str) and bool(VIDEO_ID_RE.match(value))


def priority_key(item: tuple[dict[str, Any], dict[str, Any]]) -> tuple[int, int, int, int]:
    track, use = item
    best_rank = int(use.get("bestRank", 9999))
    chart_count = len(use.get("chartIds") or [])
    uses = int(use.get("uses", 0))
    return (best_rank, -chart_count, -uses, int(track.get("id", 999999)))


def write_missing_csv(path: Path, missing: list[tuple[dict[str, Any], dict[str, Any]]]) -> None:
    with path.open("w", newline="", encoding="utf-8") as fh:
        writer = csv.DictWriter(
            fh,
            fieldnames=[
                "id",
                "key",
                "title",
                "artist",
                "year",
                "charts",
                "chartYears",
                "bestRank",
                "uses",
            ],
        )
        writer.writeheader()
        for track, use in missing:
            writer.writerow(
                {
                    "id": track.get("id"),
                    "key": track.get("key"),
                    "title": track.get("title"),
                    "artist": track.get("artist"),
                    "year": track.get("year", ""),
                    "charts": ",".join(use.get("chartIds") or []),
                    "chartYears": "|".join(str(y) for y in (use.get("years") or [])),
                    "bestRank": use.get("bestRank"),
                    "uses": use.get("uses"),
                }
            )


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--catalog", type=Path, default=DEFAULT_CATALOG)
    parser.add_argument("--charts-dir", type=Path, default=DEFAULT_CHARTS_DIR)
    parser.add_argument("--cache", type=Path, default=DEFAULT_CACHE)
    parser.add_argument("--report", type=Path, default=DEFAULT_REPORT)
    parser.add_argument("--missing-csv", type=Path, default=DEFAULT_MISSING_CSV)
    parser.add_argument("--source", choices=["auto", "api", "yt-dlp", "cache-only"], default="auto")
    parser.add_argument("--limit", type=int, default=25, help="Maximum missing tracks to process this run")
    parser.add_argument("--max-results", type=int, default=10)
    parser.add_argument("--min-score", type=float, default=12.0)
    parser.add_argument("--top-rank", type=int, default=None, help="Only process missing tracks whose best rank is <= N")
    parser.add_argument("--chart", action="append", default=[], help="Only process missing tracks used by this chartId")
    parser.add_argument("--sleep", type=float, default=0.25, help="Seconds between uncached track attempts")
    parser.add_argument("--overrides", type=Path, default=DEFAULT_OVERRIDES)
    parser.add_argument("--apply", action="store_true", help="Escribe los IDs hallados en overrides.json (destino duradero)")
    parser.add_argument("--write-catalog", action="store_true", help="Legacy: muta tracks.json en vez de overrides.json (el build lo sobrescribe)")
    parser.add_argument("--no-validate", action="store_true", help="Skip noembed validation for candidate video IDs")
    parser.add_argument("--no-official-query", action="store_true", help="Do not add official video/audio query variants for yt-dlp")
    parser.add_argument("--official-only-query", action="store_true", help="Only use official video/audio query variants for yt-dlp")
    parser.add_argument("--force", action="store_true", help="Ignore cached search results")
    parser.add_argument("--force-validation", action="store_true", help="Ignore cached noembed validation")
    return parser.parse_args(argv)


def merge_youtube_overrides(overrides_path: Path, updates: list[dict[str, Any]]) -> int:
    """Vuelca los youtubeVideoId hallados en overrides.json (tracks[<key>]).

    Cada `update` trae `key` (makeCacheKey del track) y `youtubeVideoId`. Preserva
    el resto del fichero y deja las pistas ordenadas para diffs estables.
    """
    overrides = json.loads(overrides_path.read_text(encoding="utf-8")) if overrides_path.exists() else {}
    tracks_ov = overrides.setdefault("tracks", {})
    applied = 0
    for row in updates:
        key = row.get("key")
        video_id = row.get("youtubeVideoId")
        if not key or not video_id:
            continue
        tracks_ov.setdefault(key, {})["youtubeVideoId"] = video_id
        applied += 1
    overrides["tracks"] = dict(sorted(tracks_ov.items()))
    overrides_path.parent.mkdir(parents=True, exist_ok=True)
    overrides_path.write_text(json.dumps(overrides, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return applied


def main(argv: list[str]) -> int:
    args = parse_args(argv)
    args.catalog = args.catalog.resolve()
    args.charts_dir = args.charts_dir.resolve()
    args.cache = args.cache.resolve()
    args.report = args.report.resolve()
    args.missing_csv = args.missing_csv.resolve()

    data, tracks = load_catalog(args.catalog)
    usage = load_usage(args.charts_dir)

    missing = []
    malformed = []
    for track in tracks:
        video_id = track.get("youtubeVideoId")
        if video_id and not has_good_video_id(track):
            malformed.append(track)
        if not has_good_video_id(track):
            use = usage.get(track.get("id"), {"chartIds": [], "years": [], "bestRank": 9999, "uses": 0})
            if args.chart and not set(args.chart).intersection(use.get("chartIds") or []):
                continue
            if args.top_rank is not None and int(use.get("bestRank", 9999)) > args.top_rank:
                continue
            missing.append((track, use))

    missing.sort(key=priority_key)
    write_missing_csv(args.missing_csv, missing)

    before_with_video = sum(1 for t in tracks if has_good_video_id(t))
    before_missing = len(tracks) - before_with_video

    selected = missing[: max(0, args.limit)]
    updates: list[dict[str, Any]] = []
    misses: list[dict[str, Any]] = []
    started = time.time()

    enricher = YoutubeCatalogEnricher(args)
    try:
        for idx, (track, use) in enumerate(selected, start=1):
            external_calls_before = enricher.stats["api_calls"] + enricher.stats["ytdlp_calls"]
            best, candidates, provider_errors = enricher.choose_candidate(track)
            external_calls_after = enricher.stats["api_calls"] + enricher.stats["ytdlp_calls"]
            row = {
                "id": track.get("id"),
                "key": track.get("key"),
                "title": track.get("title"),
                "artist": track.get("artist"),
                "usage": use,
                "providerErrors": provider_errors,
                "candidates": [c.as_dict() for c in candidates],
            }
            if best:
                track["youtubeVideoId"] = best.video_id
                row["youtubeVideoId"] = best.video_id
                row["selected"] = best.as_dict()
                updates.append(row)
                print(f"[{idx}/{len(selected)}] OK {track.get('artist')} - {track.get('title')} -> {best.video_id} ({best.score})")
            else:
                misses.append(row)
                print(f"[{idx}/{len(selected)}] MISS {track.get('artist')} - {track.get('title')}")
            if args.sleep and idx < len(selected) and external_calls_after > external_calls_before:
                time.sleep(args.sleep)
    finally:
        stats = dict(enricher.stats)
        enricher.close()

    backup_path = None
    overrides_path = None
    if args.apply and updates and args.write_catalog:
        OUT.mkdir(parents=True, exist_ok=True)
        backup_path = OUT / f"tracks.before_youtube_enrich.{datetime.now().strftime('%Y%m%d_%H%M%S')}.json"
        shutil.copy2(args.catalog, backup_path)
        args.catalog.write_text(
            json.dumps(data, ensure_ascii=False, separators=(",", ":")),
            encoding="utf-8",
        )
    elif args.apply and updates:
        overrides_path = args.overrides.resolve()
        merge_youtube_overrides(overrides_path, updates)

    after_with_video = sum(1 for t in tracks if has_good_video_id(t))
    after_missing = len(tracks) - after_with_video
    report = {
        "checkedAt": utc_now(),
        "catalog": str(args.catalog),
        "source": args.source,
        "apply": args.apply,
        "totalTracks": len(tracks),
        "withYoutubeBefore": before_with_video,
        "missingYoutubeBefore": before_missing,
        "withYoutubeAfter": after_with_video,
        "missingYoutubeAfter": after_missing,
        "malformedYoutubeBefore": len(malformed),
        "eligibleMissing": len(missing),
        "processed": len(selected),
        "updated": len(updates),
        "stillMissing": len(misses),
        "backup": str(backup_path) if backup_path else None,
        "overrides": str(overrides_path) if overrides_path else None,
        "cache": str(args.cache),
        "missingCsv": str(args.missing_csv),
        "elapsedSeconds": round(time.time() - started, 2),
        "stats": stats,
        "updates": updates,
        "misses": misses,
    }
    args.report.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({k: report[k] for k in [
        "totalTracks",
        "withYoutubeBefore",
        "missingYoutubeBefore",
        "eligibleMissing",
        "processed",
        "updated",
        "withYoutubeAfter",
        "missingYoutubeAfter",
        "apply",
        "backup",
        "report",
    ] if k in report} | {"report": str(args.report)}, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
