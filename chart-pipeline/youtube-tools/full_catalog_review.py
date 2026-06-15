#!/usr/bin/env python3
"""
Review every catalog track against fresh YouTube Music search results.

The script is intentionally conservative:
- every selected track is searched, even if it already has a youtubeVideoId;
- the current ID is scored from oEmbed metadata when available;
- replacements are written to chart-pipeline/overrides.json only when the new
  candidate clearly beats the current video, or when the current video is
  missing/broken.

Dry-run is the default. Use --apply after inspecting the report, or for a full
automated pass with strict thresholds.
"""

from __future__ import annotations

import argparse
import json
import re
import sqlite3
import sys
import time
from collections import Counter
from datetime import datetime
from pathlib import Path
from typing import Any

import requests

from enricher import (
    DEFAULT_CATALOG,
    DEFAULT_CHARTS_DIR,
    DEFAULT_OVERRIDES,
    NOEMBED_URL,
    VIDEO_ID_RE,
    Candidate,
    compact,
    load_catalog,
    load_usage,
    merge_youtube_overrides,
    normalize,
    primary_artist_for_track,
    priority_key,
    query_for_track,
    score_candidate,
    utc_now,
)


HERE = Path(__file__).resolve().parent
OUT = HERE / "out"
DEFAULT_REPORT = OUT / "full_catalog_review.json"
DEFAULT_CACHE = OUT / ".youtube-full-review-cache.db"


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--catalog", type=Path, default=DEFAULT_CATALOG)
    parser.add_argument("--charts-dir", type=Path, default=DEFAULT_CHARTS_DIR)
    parser.add_argument("--report", type=Path, default=DEFAULT_REPORT)
    parser.add_argument("--cache", type=Path, default=DEFAULT_CACHE)
    parser.add_argument("--overrides", type=Path, default=DEFAULT_OVERRIDES)
    parser.add_argument("--ids", default="", help="Comma-separated catalog track ids")
    parser.add_argument("--limit", type=int, default=0, help="0 means all selected tracks")
    parser.add_argument("--offset", type=int, default=0)
    parser.add_argument("--priority", choices=["id", "usage"], default="id")
    parser.add_argument("--filters", default="songs,videos")
    parser.add_argument("--variant-limit", type=int, default=3)
    parser.add_argument("--max-results", type=int, default=8)
    parser.add_argument("--min-score", type=float, default=16.0)
    parser.add_argument("--missing-min-score", type=float, default=14.5)
    parser.add_argument("--replace-margin", type=float, default=2.5)
    parser.add_argument("--weak-current-score", type=float, default=12.0)
    parser.add_argument("--sleep", type=float, default=0.05)
    parser.add_argument("--request-timeout", type=float, default=20.0)
    parser.add_argument("--retries", type=int, default=2)
    parser.add_argument("--top-candidates", type=int, default=5)
    parser.add_argument("--checkpoint-every", type=int, default=25)
    parser.add_argument("--progress-every", type=int, default=10)
    parser.add_argument("--resume", action="store_true")
    parser.add_argument("--force", action="store_true", help="Ignore cached searches and oEmbed results")
    parser.add_argument("--apply", action="store_true", help="Write accepted changes to overrides.json")
    return parser.parse_args(argv)


def read_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def write_json(path: Path, data: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def selected_ids(value: str) -> set[int] | None:
    ids = set()
    for part in str(value or "").split(","):
        part = part.strip()
        if not part:
            continue
        ids.add(int(part))
    return ids or None


class ReviewCache:
    def __init__(self, path: Path, force: bool = False) -> None:
        self.path = path
        self.force = force
        self.conn = sqlite3.connect(path)
        self.conn.row_factory = sqlite3.Row
        self.conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS ytmusic_search (
              query TEXT NOT NULL,
              filter_name TEXT NOT NULL,
              status TEXT NOT NULL,
              items_json TEXT NOT NULL,
              error TEXT,
              fetched_at TEXT NOT NULL,
              PRIMARY KEY (query, filter_name)
            );
            CREATE TABLE IF NOT EXISTS video_oembed (
              video_id TEXT PRIMARY KEY,
              ok INTEGER NOT NULL,
              title TEXT,
              author_name TEXT,
              error TEXT,
              status_code INTEGER,
              fetched_at TEXT NOT NULL
            );
            """
        )
        self.conn.commit()
        self.stats = Counter()

    def close(self) -> None:
        self.conn.close()

    def get_search(self, query: str, filter_name: str) -> tuple[str, list[dict[str, Any]], str | None] | None:
        if self.force:
            return None
        row = self.conn.execute(
            "SELECT status, items_json, error FROM ytmusic_search WHERE query = ? AND filter_name = ?",
            (query, filter_name),
        ).fetchone()
        if not row:
            return None
        self.stats["search_cache_hits"] += 1
        return row["status"], json.loads(row["items_json"]), row["error"]

    def put_search(self, query: str, filter_name: str, status: str, items: list[dict[str, Any]], error: str | None) -> None:
        self.conn.execute(
            """
            INSERT OR REPLACE INTO ytmusic_search
              (query, filter_name, status, items_json, error, fetched_at)
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            (query, filter_name, status, json.dumps(items, ensure_ascii=False), error, utc_now()),
        )
        self.conn.commit()

    def get_video(self, video_id: str) -> dict[str, Any] | None:
        if self.force:
            return None
        row = self.conn.execute(
            "SELECT ok, title, author_name, error, status_code FROM video_oembed WHERE video_id = ?",
            (video_id,),
        ).fetchone()
        if not row:
            return None
        self.stats["video_cache_hits"] += 1
        return {
            "ok": bool(row["ok"]),
            "title": row["title"],
            "authorName": row["author_name"],
            "error": row["error"],
            "statusCode": row["status_code"],
        }

    def put_video(self, video_id: str, row: dict[str, Any]) -> None:
        self.conn.execute(
            """
            INSERT OR REPLACE INTO video_oembed
              (video_id, ok, title, author_name, error, status_code, fetched_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            (
                video_id,
                int(bool(row.get("ok"))),
                row.get("title"),
                row.get("authorName"),
                row.get("error"),
                row.get("statusCode"),
                utc_now(),
            ),
        )
        self.conn.commit()


def title_core(title: str) -> str:
    value = re.sub(r"[\[(].*?[\])]", " ", str(title or ""))
    return re.sub(r"\s+", " ", value).strip() or str(title or "").strip()


def query_variants(track: dict[str, Any]) -> list[str]:
    artist = str(track.get("artist") or "").strip()
    primary = primary_artist_for_track(track)
    title = str(track.get("title") or "").strip()
    core = title_core(title)
    base = query_for_track(track)
    variants = [
        f"{artist} {title}",
        f"{primary} {title}",
        f"{base} official music video",
        f"{artist} {core} official video",
        f"{primary} {core} official audio",
        f"{title} {primary}",
    ]
    out: list[str] = []
    seen: set[str] = set()
    for query in variants:
        query = re.sub(r"\s+", " ", query).strip()
        key = normalize(query)
        if query and key not in seen:
            out.append(query)
            seen.add(key)
    return out


def duration_seconds(value: str | None) -> int | None:
    if not value:
        return None
    parts = str(value).split(":")
    try:
        total = 0
        for part in parts:
            total = total * 60 + int(part)
        return total
    except ValueError:
        return None


def item_channel(item: dict[str, Any]) -> str:
    artists = item.get("artists") or []
    names = [str(a.get("name") or "") for a in artists if isinstance(a, dict) and a.get("name")]
    if names:
        return ", ".join(names)
    return str(item.get("author") or item.get("channel") or item.get("playlist") or "")


def item_raw(item: dict[str, Any]) -> dict[str, str]:
    return {
        "video_id": str(item.get("videoId") or ""),
        "title": str(item.get("title") or ""),
        "channel": item_channel(item),
    }


def artist_parts(track: dict[str, Any]) -> list[str]:
    values = [str(track.get("artist") or "")]
    key = str(track.get("key") or "")
    if "::" in key:
        values.append(key.split("::", 1)[0])

    parts: list[str] = []
    seen: set[str] = set()
    for value in values:
        for part in re.split(r",|;|\s+(?:feat\.?|ft\.?|with|and|&|x|y)\s+", value, flags=re.I):
            norm = normalize(part)
            compacted = compact(part)
            if norm and len(compacted) > 1 and compacted not in seen:
                parts.append(norm)
                seen.add(compacted)
    return parts


def artist_part_hit_count(raw: dict[str, str], track: dict[str, Any]) -> tuple[int, int]:
    haystack = compact(f"{raw.get('title', '')} {raw.get('channel', '')}")
    hits = 0
    parts = artist_parts(track)
    for part in parts:
        part_compact = compact(part)
        if part_compact and part_compact in haystack:
            hits += 1
    return hits, len(parts)


def artist_part_bonus(raw: dict[str, str], track: dict[str, Any]) -> float:
    hits, _total = artist_part_hit_count(raw, track)
    return min(3.0, hits * 1.25)


def trusted_channel(channel: str, track: dict[str, Any]) -> bool:
    channel_norm = normalize(channel)
    channel_compact = compact(channel)
    if not channel_compact:
        return False
    if re.search(r"\bfan\b|\bfans\b|fanclub|fan\s*tv", channel_norm):
        return False
    for part in artist_parts(track):
        part_compact = compact(part)
        if not part_compact:
            continue
        if channel_compact == part_compact:
            return True
        if channel_compact.startswith(part_compact) and channel_compact[len(part_compact):] in {
            "music",
            "oficial",
            "official",
            "officialartistchannel",
            "topic",
            "tv",
            "vevo",
            "video",
            "videos",
        }:
            return True
    return False


def metadata_flags(raw: dict[str, str], track: dict[str, Any], filter_name: str | None = None) -> dict[str, Any]:
    title_norm = normalize(raw.get("title", ""))
    channel_norm = normalize(raw.get("channel", ""))
    trusted = trusted_channel(raw.get("channel", ""), track)
    artist_hits, artist_total = artist_part_hit_count(raw, track)
    official_video_title = bool(
        re.search(
            r"\bofficial\s*(music\s*)?video\b|\bofficial\s*performance\s*video\b|\bvideo\s*clip\b|\bvideoclip\b",
            title_norm,
        )
    )
    official_audio_title = bool(re.search(r"\bofficial\s*audio\b", title_norm))
    fan_channel = bool(re.search(r"\bfan\b|\bfans\b|fanclub|fan\s*tv", channel_norm))
    official_channel = (
        not fan_channel
        and (
            "official" in channel_norm
            or "oficial" in channel_norm
            or ("vevo" in channel_norm and trusted)
            or channel_norm.endswith("topic")
        )
    )
    return {
        "trustedChannel": trusted,
        "officialVideoTitle": official_video_title,
        "officialAudioTitle": official_audio_title,
        "officialVideo": official_video_title and (trusted or official_channel),
        "officialAudio": official_audio_title and (trusted or official_channel),
        "officialChannel": official_channel,
        "songResult": filter_name == "songs",
        "videoResult": filter_name == "videos",
        "artistPartHits": artist_hits,
        "artistPartTotal": artist_total,
    }


def alternative_version_penalty(title_norm: str, requested_norm: str) -> float:
    penalty = 0.0
    language_version = re.search(
        r"\b(spanish|espanol|español|spanglish|english|french|francaise|française|italian|portuguese|"
        r"versione italiana|version francaise|version française)\b",
        title_norm,
    )
    if language_version and not re.search(
        r"\b(spanish|espanol|español|spanglish|english|french|francaise|française|italian|portuguese|"
        r"versione italiana|version francaise|version française)\b",
        requested_norm,
    ):
        penalty += 7.0
    if re.search(r"\b(20\d{2}|19\d{2})\s+(radio\s+)?mix\b|\bradio\s+mix\b|\bclub\s+mix\b", title_norm) and not re.search(
        r"\b(20\d{2}|19\d{2}|radio\s+mix|club\s+mix)\b",
        requested_norm,
    ):
        penalty += 6.0
    if re.search(r"\b(remix|mix|gritando mix|soulchild remix)\b", title_norm) and not re.search(r"\b(remix|mix)\b", requested_norm):
        penalty += 6.0
    if re.search(r"\b(alt\.?\s*version|alternative version|version alternativa)\b", title_norm) and not re.search(
        r"\b(alt\.?\s*version|alternative version|version alternativa)\b",
        requested_norm,
    ):
        penalty += 6.0
    if re.search(r"\b(crossroads|movie|film|soundtrack|album|video)\s+version\b", title_norm) and not re.search(
        r"\b(crossroads|movie|film|soundtrack|album|video)\s+version\b",
        requested_norm,
    ):
        penalty += 6.0
    if re.search(r"\b(live|directo|en vivo|actuacion|actuación|performance|mediafest|salvame|sálvame|petit comite|petit comité|unplugged|luar|tvg|teatro real|premios|awards|gala)\b", title_norm) and not re.search(
        r"\b(live|directo|actuacion|actuación|performance|session|unplugged)\b",
        requested_norm,
    ):
        penalty += 8.0
    if re.search(r"\b(acoustic|acustico|acústico|acustica|acústica|version acustica|versión acústica)\b", title_norm) and not re.search(
        r"\b(acoustic|acustico|acústico|acustica|acústica)\b",
        requested_norm,
    ):
        penalty += 8.0
    if re.search(r"\b\d{1,2}[./-]\d{1,2}[./-]20\d{2}\b", title_norm) and "20" not in requested_norm:
        penalty += 5.0
    if re.search(r"\b(feat|featuring|ft)\b", title_norm) and not re.search(r"\b(feat|featuring|ft)\b", requested_norm):
        # A featured artist in search results can be a different single version.
        penalty += 1.5
    return penalty


def requested_allows_long(track: dict[str, Any]) -> bool:
    requested = normalize(track.get("title", ""))
    return bool(re.search(r"\b(live|session|extended|mix|medley|part|album)\b", requested))


def too_long_for_track(item: dict[str, Any], track: dict[str, Any]) -> bool:
    seconds = duration_seconds(item.get("duration"))
    if seconds is None:
        return False
    return seconds > (900 if requested_allows_long(track) else 540)


def adjusted_candidate(
    raw: dict[str, str],
    item: dict[str, Any],
    track: dict[str, Any],
    rank: int,
    filter_name: str,
    query: str,
) -> dict[str, Any] | None:
    if too_long_for_track(item, track):
        return None

    candidate = score_candidate(raw, track, rank, f"ytmusic:{filter_name}")
    if not candidate:
        return None

    title_norm = normalize(raw.get("title", ""))
    requested_norm = normalize(track.get("title", ""))
    duration = duration_seconds(item.get("duration"))
    score = float(candidate.score)
    flags = metadata_flags(raw, track, filter_name)

    if filter_name == "videos":
        score += 0.75
    elif filter_name == "songs":
        score += 1.25
    score += artist_part_bonus(raw, track)

    requested_ms = track.get("durationMs")
    if duration and isinstance(requested_ms, int) and requested_ms > 0:
        delta = abs(duration - requested_ms / 1000)
        if delta <= 8:
            score += 2.5
        elif delta <= 20:
            score += 1.5
        elif delta <= 45:
            score += 0.75
        elif delta >= 120 and not requested_allows_long(track):
            score -= 2.5

    if "official music video" in title_norm or "official video" in title_norm or "videoclip" in title_norm:
        score += 1.0
        if not flags["trustedChannel"] and not flags["officialChannel"]:
            score -= 4.0
    if "official audio" in title_norm:
        score += 0.5
    if "remaster" in title_norm and "remaster" not in requested_norm:
        score -= 1.0
    version_penalty = alternative_version_penalty(title_norm, requested_norm)
    score -= version_penalty

    candidate.score = round(score, 3)
    row = candidate.as_dict()
    row.update(
        {
            "filter": filter_name,
            "query": query,
            "duration": item.get("duration"),
            "durationSeconds": duration,
            "resultType": item.get("resultType"),
            "album": item.get("album", {}).get("name") if isinstance(item.get("album"), dict) else item.get("album"),
            "versionPenalty": version_penalty,
            **flags,
        }
    )
    return row


def search_with_retries(
    ytmusic: Any,
    cache: ReviewCache,
    query: str,
    filter_name: str,
    limit: int,
    retries: int,
) -> tuple[list[dict[str, Any]], str | None]:
    cached = cache.get_search(query, filter_name)
    if cached:
        status, items, error = cached
        return items if status == "ok" else [], error

    last_error = None
    for attempt in range(retries + 1):
        try:
            items = ytmusic.search(query, filter=filter_name, limit=limit)
            cache.stats["search_calls"] += 1
            cache.put_search(query, filter_name, "ok", items, None)
            return items, None
        except Exception as exc:  # noqa: BLE001 - provider failures are concrete report data.
            last_error = f"{type(exc).__name__}: {exc}"
            if attempt < retries:
                time.sleep(1 + attempt)

    cache.stats["search_errors"] += 1
    cache.put_search(query, filter_name, "error", [], last_error)
    return [], last_error


def validate_video(video_id: str | None, session: requests.Session, cache: ReviewCache, timeout: float) -> dict[str, Any]:
    if not video_id:
        return {"ok": False, "error": "missing"}
    if not VIDEO_ID_RE.match(video_id):
        return {"ok": False, "error": "malformed"}
    cached = cache.get_video(video_id)
    if cached is not None:
        return cached

    cache.stats["video_calls"] += 1
    try:
        res = session.get(NOEMBED_URL, params={"url": f"https://www.youtube.com/watch?v={video_id}"}, timeout=timeout)
        data = res.json() if res.text else {}
        error = data.get("error")
        row = {
            "ok": res.status_code == 200 and not error and bool(data.get("title")),
            "title": data.get("title"),
            "authorName": data.get("author_name"),
            "error": error,
            "statusCode": res.status_code,
        }
    except Exception as exc:  # noqa: BLE001
        row = {
            "ok": False,
            "title": None,
            "authorName": None,
            "error": f"{type(exc).__name__}: {exc}",
            "statusCode": None,
        }
    cache.put_video(video_id, row)
    return row


def is_transient_validation_error(validation: dict[str, Any]) -> bool:
    error = str(validation.get("error") or "").lower()
    return "timeout" in error or "connectionerror" in error or "temporarily" in error


def current_score(track: dict[str, Any], video_id: str | None, metadata: dict[str, Any], candidates: dict[str, dict[str, Any]]) -> float | None:
    if not video_id or not metadata.get("ok"):
        return None
    raw = {
        "video_id": video_id,
        "title": str(metadata.get("title") or ""),
        "channel": str(metadata.get("authorName") or ""),
    }
    scored = score_candidate(raw, track, 0, "current")
    score = float(scored.score) if scored else 0.0
    score += artist_part_bonus(raw, track)
    flags = metadata_flags(raw, track)
    if flags["officialVideo"]:
        score += 2.0
    elif flags["officialAudio"]:
        score += 1.0
    searched = candidates.get(video_id)
    if searched:
        score = max(score, float(searched.get("score") or 0))
    return round(score, 3)


def candidate_is_current(candidate: dict[str, Any] | None, current_id: str | None) -> bool:
    return bool(candidate and current_id and candidate.get("videoId") == current_id)


def choose_best_valid(
    candidates: list[dict[str, Any]],
    track: dict[str, Any],
    session: requests.Session,
    cache: ReviewCache,
    timeout: float,
) -> dict[str, Any] | None:
    for candidate in candidates:
        validation = validate_video(str(candidate.get("videoId") or ""), session, cache, timeout)
        candidate["valid"] = bool(validation.get("ok"))
        candidate["validationReason"] = validation.get("error")
        candidate["validationTitle"] = validation.get("title")
        candidate["validationAuthor"] = validation.get("authorName")
        if validation.get("ok"):
            validation_raw = {
                "video_id": str(candidate.get("videoId") or ""),
                "title": str(validation.get("title") or candidate.get("title") or ""),
                "channel": str(validation.get("authorName") or candidate.get("channel") or ""),
            }
            validation_flags = metadata_flags(validation_raw, track, str(candidate.get("filter") or ""))
            for key, value in validation_flags.items():
                candidate[key] = value
            validation_penalty = alternative_version_penalty(
                normalize(validation_raw["title"]),
                normalize(track.get("title", "")),
            )
            candidate["validationVersionPenalty"] = validation_penalty
            if validation_penalty:
                candidate["score"] = round(float(candidate.get("score") or 0) - validation_penalty, 3)
            return candidate
    return None


def review_track(
    track: dict[str, Any],
    ytmusic: Any,
    session: requests.Session,
    cache: ReviewCache,
    args: argparse.Namespace,
) -> dict[str, Any]:
    current_id = track.get("youtubeVideoId") if isinstance(track.get("youtubeVideoId"), str) else None
    current_validation = validate_video(current_id, session, cache, args.request_timeout)

    provider_errors: list[str] = []
    by_id: dict[str, dict[str, Any]] = {}
    filters = [f.strip() for f in str(args.filters or "").split(",") if f.strip()] or ["songs", "videos"]

    for query in query_variants(track)[: max(1, args.variant_limit)]:
        for filter_name in filters:
            items, error = search_with_retries(ytmusic, cache, query, filter_name, args.max_results, args.retries)
            if error:
                provider_errors.append(f"{filter_name}:{query}: {error}")
            for rank, item in enumerate(items):
                raw = item_raw(item)
                if not VIDEO_ID_RE.match(raw["video_id"]):
                    continue
                candidate = adjusted_candidate(raw, item, track, rank, filter_name, query)
                if not candidate:
                    continue
                previous = by_id.get(candidate["videoId"])
                if previous is None or float(candidate["score"]) > float(previous.get("score") or 0):
                    by_id[candidate["videoId"]] = candidate
            if args.sleep:
                time.sleep(args.sleep)

    candidates = sorted(
        by_id.values(),
        key=lambda row: (-float(row.get("score") or 0), int(row.get("sourceRank") or 0)),
    )
    best = choose_best_valid(candidates, track, session, cache, args.request_timeout)
    score_now = current_score(track, current_id, current_validation, by_id)
    current_flags: dict[str, bool] = {}
    if current_id and current_validation.get("ok"):
        current_flags = metadata_flags(
            {
                "video_id": current_id,
                "title": str(current_validation.get("title") or ""),
                "channel": str(current_validation.get("authorName") or ""),
            },
            track,
        )
        current_flags["versionPenalty"] = bool(
            alternative_version_penalty(
                normalize(str(current_validation.get("title") or "")),
                normalize(track.get("title", "")),
            )
        )

    decision = "keep"
    reason = "current video is valid and no clearly better candidate was found"
    selected_id = current_id
    update_id = None
    threshold = args.min_score if current_validation.get("ok") else args.missing_min_score
    best_reliable = bool(best and (best.get("trustedChannel") or best.get("officialChannel")))
    best_variant_penalty = float(best.get("versionPenalty") or 0) + float(best.get("validationVersionPenalty") or 0) if best else 0.0

    if not current_id:
        if best and best_reliable and best_variant_penalty <= 0 and float(best.get("score") or 0) >= args.missing_min_score:
            decision = "add"
            reason = "missing current video; selected best validated candidate"
            selected_id = str(best.get("videoId"))
            update_id = selected_id
        else:
            decision = "unresolved_missing"
            reason = "missing current video and no validated candidate above threshold"
            selected_id = None
    elif not current_validation.get("ok") and is_transient_validation_error(current_validation):
        decision = "keep_unverified"
        reason = f"current video validation was transient: {current_validation.get('error') or 'unknown'}"
    elif not current_validation.get("ok"):
        if best and best_reliable and best_variant_penalty <= 0 and float(best.get("score") or 0) >= args.missing_min_score:
            decision = "replace_broken"
            reason = f"current video failed validation: {current_validation.get('error') or 'unknown'}"
            selected_id = str(best.get("videoId"))
            update_id = selected_id
        else:
            decision = "unresolved_broken"
            reason = "current video failed validation and no replacement cleared threshold"
    elif candidate_is_current(best, current_id):
        decision = "keep"
        reason = "current video is also the best validated search result"
    elif best and float(best.get("score") or 0) >= threshold:
        best_score = float(best.get("score") or 0)
        current_score_value = score_now if score_now is not None else 0.0
        clear_margin = best_score - current_score_value >= args.replace_margin
        weak_current = current_score_value < args.weak_current_score and best_score - current_score_value >= 1.0
        current_trusted = bool(current_flags.get("trustedChannel") or current_flags.get("officialChannel"))
        best_trusted = bool(best.get("trustedChannel") or best.get("officialChannel"))
        current_is_variant = bool(current_flags.get("versionPenalty"))
        current_artist_hits = int(current_flags.get("artistPartHits") or 0)
        best_artist_hits = int(best.get("artistPartHits") or 0)
        artist_part_total = max(int(current_flags.get("artistPartTotal") or 0), int(best.get("artistPartTotal") or 0))
        candidate_allowed = True
        current_has_official_video_title = bool(current_flags.get("officialVideo") or current_flags.get("officialVideoTitle"))
        if current_has_official_video_title and not best.get("officialVideo"):
            candidate_allowed = False
            reason = "current is a validated official video; best candidate is not an official video"
        elif artist_part_total > 1 and current_artist_hits > best_artist_hits and current_score_value >= args.weak_current_score:
            candidate_allowed = False
            reason = "current video covers more credited artists than the replacement candidate"
        elif current_trusted and not best_trusted:
            candidate_allowed = False
            reason = "current comes from a trusted/official channel; best candidate does not"
        elif not best_trusted:
            candidate_allowed = False
            reason = "best candidate is not from a trusted/official channel"
        elif best_variant_penalty > 0:
            candidate_allowed = False
            reason = "best candidate is a live/remix/version variant not requested by the catalog title"
        elif current_trusted and not current_is_variant and not best.get("officialVideo") and current_score_value >= args.weak_current_score:
            candidate_allowed = False
            reason = "current trusted video is valid; best candidate is not an official video"
        elif current_score_value >= 20 and not best.get("officialVideo") and best_score - current_score_value < 4.0:
            candidate_allowed = False
            reason = "current video already scores high; non-official-video candidate margin is too small"
        elif not best.get("officialVideo") and int(best.get("sourceRank") or 0) > 3:
            candidate_allowed = False
            reason = "best non-official-video candidate is too deep in search results"

        if candidate_allowed and (clear_margin or weak_current):
            decision = "replace"
            reason = f"candidate score {best_score:.3f} beats current score {current_score_value:.3f}"
            selected_id = str(best.get("videoId"))
            update_id = selected_id

    return {
        "id": track.get("id"),
        "key": track.get("key"),
        "artist": track.get("artist"),
        "title": track.get("title"),
        "currentYoutubeVideoId": current_id,
        "currentVideo": {
            **current_validation,
            "score": score_now,
            **current_flags,
        },
        "selectedYoutubeVideoId": selected_id,
        "newYoutubeVideoId": update_id,
        "decision": decision,
        "reason": reason,
        "providerErrors": provider_errors,
        "bestCandidate": best,
        "candidates": candidates[: max(1, args.top_candidates)],
    }


def make_report(
    args: argparse.Namespace,
    tracks: list[dict[str, Any]],
    rows: list[dict[str, Any]],
    started: float,
    completed: bool,
    cache: ReviewCache | None = None,
) -> dict[str, Any]:
    decisions = Counter(str(row.get("decision")) for row in rows)
    updates = [
        row
        for row in rows
        if row.get("newYoutubeVideoId") and row.get("newYoutubeVideoId") != row.get("currentYoutubeVideoId")
    ]
    stats = dict(cache.stats) if cache else {}
    return {
        "checkedAt": utc_now(),
        "completed": completed,
        "catalog": str(args.catalog.resolve()),
        "apply": bool(args.apply),
        "thresholds": {
            "minScore": args.min_score,
            "missingMinScore": args.missing_min_score,
            "replaceMargin": args.replace_margin,
            "weakCurrentScore": args.weak_current_score,
        },
        "selection": {
            "ids": args.ids,
            "limit": args.limit,
            "offset": args.offset,
            "priority": args.priority,
            "filters": args.filters,
            "variantLimit": args.variant_limit,
            "maxResults": args.max_results,
        },
        "totalCatalogTracks": len(tracks),
        "withYoutubeBefore": sum(1 for track in tracks if isinstance(track.get("youtubeVideoId"), str) and VIDEO_ID_RE.match(track["youtubeVideoId"])),
        "processed": len(rows),
        "elapsedSeconds": round(time.time() - started, 2),
        "summary": {
            **dict(sorted(decisions.items())),
            "updates": len(updates),
        },
        "stats": stats,
        "updates": updates,
        "rows": rows,
    }


def load_resume_rows(path: Path) -> list[dict[str, Any]]:
    if not path.exists():
        return []
    payload = read_json(path)
    rows = payload.get("rows")
    return rows if isinstance(rows, list) else []


def main(argv: list[str]) -> int:
    args = parse_args(argv)
    args.catalog = args.catalog.resolve()
    args.charts_dir = args.charts_dir.resolve()
    args.report = args.report.resolve()
    args.cache = args.cache.resolve()

    original_request = requests.sessions.Session.request

    def request_with_timeout(self: requests.Session, method: str, url: str, **kwargs: Any) -> requests.Response:
        kwargs.setdefault("timeout", args.request_timeout)
        return original_request(self, method, url, **kwargs)

    requests.sessions.Session.request = request_with_timeout

    try:
        from ytmusicapi import YTMusic
    except ImportError:
        print("ytmusicapi is not installed in the current Python environment.", file=sys.stderr)
        return 2

    data, tracks = load_catalog(args.catalog)
    usage = load_usage(args.charts_dir)
    wanted_ids = selected_ids(args.ids)
    selected = [track for track in tracks if wanted_ids is None or int(track.get("id", -1)) in wanted_ids]
    if args.priority == "usage":
        selected.sort(key=lambda track: priority_key((track, usage.get(track.get("id"), {"chartIds": [], "years": [], "bestRank": 9999, "uses": 0}))))
    else:
        selected.sort(key=lambda track: int(track.get("id", 999999)))
    if args.offset:
        selected = selected[args.offset :]
    if args.limit > 0:
        selected = selected[: args.limit]

    started = time.time()
    resume_rows = load_resume_rows(args.report) if args.resume else []
    rows_by_id = {int(row["id"]): row for row in resume_rows if isinstance(row.get("id"), int)}
    rows: list[dict[str, Any]] = [rows_by_id[int(track["id"])] for track in selected if int(track.get("id", -1)) in rows_by_id]
    processed_ids = {int(row["id"]) for row in rows if isinstance(row.get("id"), int)}

    cache = ReviewCache(args.cache, force=args.force)
    ytmusic = YTMusic()
    session = requests.Session()

    try:
        todo = [track for track in selected if int(track.get("id", -1)) not in processed_ids]
        total = len(selected)
        for index, track in enumerate(todo, start=len(rows) + 1):
            row = review_track(track, ytmusic, session, cache, args)
            rows.append(row)
            if args.progress_every and (index == total or index % args.progress_every == 0):
                print(
                    f"[{index}/{total}] {row['decision']} {row['artist']} - {row['title']} "
                    f"{row.get('currentYoutubeVideoId') or '-'} -> {row.get('selectedYoutubeVideoId') or '-'}",
                    flush=True,
                )
            if args.checkpoint_every and index % args.checkpoint_every == 0:
                write_json(args.report, make_report(args, tracks, rows, started, False, cache))

        report = make_report(args, tracks, rows, started, True, cache)
        write_json(args.report, report)

        if args.apply:
            updates = [
                {
                    "key": row.get("key"),
                    "youtubeVideoId": row.get("newYoutubeVideoId"),
                }
                for row in rows
                if row.get("newYoutubeVideoId") and row.get("newYoutubeVideoId") != row.get("currentYoutubeVideoId")
            ]
            applied = merge_youtube_overrides(args.overrides.resolve(), updates)
            report["overrides"] = str(args.overrides.resolve())
            report["applied"] = applied
            write_json(args.report, report)
            print(f"applied {applied} updates to {args.overrides.resolve()}", flush=True)
        else:
            print(f"dry-run: {len(report['updates'])} proposed updates", flush=True)

        print(
            json.dumps(
                {
                    "processed": report["processed"],
                    "summary": report["summary"],
                    "report": str(args.report),
                    "elapsedSeconds": report["elapsedSeconds"],
                },
                ensure_ascii=False,
                indent=2,
            ),
            flush=True,
        )
        return 0
    finally:
        cache.close()
        session.close()


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
