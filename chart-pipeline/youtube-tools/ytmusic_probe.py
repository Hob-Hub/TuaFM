#!/usr/bin/env python3
"""
Probe missing catalog YouTube IDs with ytmusicapi.

This is intentionally conservative: dry-run by default, scored with the same
enricher.score_candidate function, and only writes with --apply.
"""

from __future__ import annotations

import argparse
import json
import re
import shutil
import sys
import time
from datetime import datetime
from difflib import SequenceMatcher
from pathlib import Path
from typing import Any

import requests

from enricher import (
    DEFAULT_CATALOG,
    DEFAULT_CHARTS_DIR,
    DEFAULT_OVERRIDES,
    VIDEO_ID_RE,
    compact,
    has_good_video_id,
    load_catalog,
    normalize,
    load_usage,
    merge_youtube_overrides,
    primary_artist_for_track,
    priority_key,
    query_for_track,
    score_candidate,
    utc_now,
)


HERE = Path(__file__).resolve().parent
OUT = HERE / "out"
ROOT = Path(__file__).resolve().parents[2]
DEFAULT_REPORT = OUT / "ytmusic_probe_report.json"


def title_core(title: str) -> str:
    value = re.sub(r"[\[(].*?[\])]", " ", str(title or ""))
    value = re.sub(r"\s+", " ", value).strip()
    return value or str(title or "").strip()


def query_variants(track: dict[str, Any]) -> list[str]:
    artist = str(track.get("artist") or "").strip()
    primary = primary_artist_for_track(track)
    title = str(track.get("title") or "").strip()
    core = title_core(title)
    variants = [
        f"{artist} {title} official video",
        f"{artist} {title}",
        f"{primary} {title} official video",
        f"{artist} {core} official video",
        f"{primary} {core} official video",
        f"{query_for_track(track)} official video",
    ]
    seen: set[str] = set()
    out: list[str] = []
    for query in variants:
        query = re.sub(r"\s+", " ", query).strip()
        key = query.lower()
        if query and key not in seen:
            out.append(query)
            seen.add(key)
    return out


def duration_seconds(value: str | None) -> int | None:
    if not value:
        return None
    parts = value.split(":")
    try:
        total = 0
        for part in parts:
            total = total * 60 + int(part)
        return total
    except ValueError:
        return None


def as_raw(item: dict[str, Any]) -> dict[str, str]:
    artists = item.get("artists") or []
    channel = ", ".join(str(a.get("name") or "") for a in artists if a.get("name"))
    return {
        "video_id": str(item.get("videoId") or ""),
        "title": str(item.get("title") or ""),
        "channel": channel,
    }


def search_items(ytmusic: Any, query: str, search_filter: str, limit: int, retries: int) -> tuple[list[dict[str, Any]], str | None]:
    last_error: str | None = None
    for attempt in range(retries + 1):
        try:
            return ytmusic.search(query, filter=search_filter, limit=limit), None
        except Exception as exc:  # ytmusicapi can raise JSONDecodeError on transient bad responses.
            last_error = f"{type(exc).__name__}: {exc}"
            if attempt < retries:
                time.sleep(1 + attempt)
    return [], last_error


def split_artist_parts(value: str) -> list[str]:
    parts = re.split(r",|;|\s+(?:feat\.?|ft\.?|with|and|&|x)\s+", str(value or ""), flags=re.I)
    seen: set[str] = set()
    out: list[str] = []
    for part in parts:
        norm = normalize(part)
        if norm and norm not in seen:
            out.append(norm)
            seen.add(norm)
    return out


TITLE_NOISE_TOKENS = {
    "album",
    "bof",
    "deluxe",
    "edition",
    "ep",
    "extra",
    "extrait",
    "feat",
    "featuring",
    "mix",
    "pub",
    "remix",
    "remixed",
    "remixes",
    "single",
    "the",
    "version",
    "with",
}


def title_match_tokens(value: str) -> list[str]:
    return [
        token
        for token in normalize(value).split()
        if len(token) > 1 and token not in TITLE_NOISE_TOKENS
    ]


def title_options(value: str) -> list[str]:
    core = re.sub(r"[\[(].*?[\])]", " ", str(value or ""))
    core = re.sub(r"\b(?:ep|single|remixes?|album version|bof|pub)\b", " ", core, flags=re.I)
    options = [core]
    options.extend(re.split(r"\s*/\s*|\s+-\s+", core))
    seen: set[str] = set()
    out: list[str] = []
    for option in options:
        norm = normalize(option)
        if norm and norm not in seen:
            out.append(norm)
            seen.add(norm)
    return out


def compatible_title_match(raw_title: str, requested_title: str) -> bool:
    raw_options = title_options(raw_title)
    requested_options = title_options(requested_title)
    for raw_option in raw_options:
        raw_tokens = set(title_match_tokens(raw_option))
        raw_compact = compact(raw_option)
        for requested_option in requested_options:
            if raw_option == requested_option:
                return True
            requested_tokens = set(title_match_tokens(requested_option))
            requested_compact = compact(requested_option)
            if not raw_tokens or not requested_tokens:
                continue
            if requested_tokens.issubset(raw_tokens) and len(requested_tokens) >= 2:
                return True
            if raw_tokens.issubset(requested_tokens):
                if len(raw_tokens) >= 2:
                    return True
                if len(next(iter(raw_tokens))) >= 4:
                    return True
            if raw_compact and requested_compact:
                ratio = SequenceMatcher(None, raw_compact, requested_compact).ratio()
                if ratio >= 0.88 and (raw_tokens & requested_tokens):
                    return True
    return False


def strict_song_match(raw: dict[str, str], track: dict[str, Any]) -> bool:
    """Accept low-score YT Music song hits only when title and artist are tight."""
    raw_title = raw.get("title", "")
    requested_title = str(track.get("title", ""))
    if not compatible_title_match(raw_title, requested_title):
        return False

    raw_text = f"{raw_title} {raw.get('channel', '')}"
    raw_norm = normalize(raw_text)
    raw_compact = compact(raw_text)
    requested_norm = normalize(f"{track.get('artist', '')} {requested_title}")

    bad_patterns = [
        r"\boriginally performed\b",
        r"\bin the style of\b",
        r"\b(tribute|homage|reaction|tutorial|8d|nightcore|sped up|slowed)\b",
        r"\b(instrumental|karaoketop|gynmusic|kar vogue|kar4sing)\b",
        r"\b(cover|karaoke)\b",
        r"\b(remix|edit|mix)\b",
        r"\b(live|session|sessions|acoustic|acustico|acustico)\b",
    ]
    for pattern in bad_patterns:
        if re.search(pattern, raw_norm) and not re.search(pattern, requested_norm):
            return False

    primary = normalize(primary_artist_for_track(track))
    artist_parts = split_artist_parts(track.get("artist", ""))
    if primary and primary not in artist_parts:
        artist_parts.insert(0, primary)

    for part in artist_parts:
        part_compact = compact(part)
        if len(part_compact) > 2 and part_compact in raw_compact:
            return True
        tokens = [t for t in part.split() if len(t) > 3]
        if tokens and any(token in raw_norm for token in tokens):
            return True
    return False


def too_long(candidate: dict[str, Any], track: dict[str, Any]) -> bool:
    seconds = duration_seconds(candidate.get("duration"))
    if seconds is None:
        return False
    requested = str(track.get("title") or "").lower()
    if re.search(r"\b(live|session|extended|mix|part)\b", requested):
        return seconds > 900
    return seconds > 540


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--catalog", type=Path, default=DEFAULT_CATALOG)
    parser.add_argument("--charts-dir", type=Path, default=DEFAULT_CHARTS_DIR)
    parser.add_argument("--report", type=Path, default=DEFAULT_REPORT)
    parser.add_argument("--limit", type=int, default=5000)
    parser.add_argument("--max-results", type=int, default=10)
    parser.add_argument("--variant-limit", type=int, default=3)
    parser.add_argument("--search-filters", default="videos", help="Comma-separated ytmusic filters, e.g. videos,songs")
    parser.add_argument("--min-score", type=float, default=16.0)
    parser.add_argument("--sleep", type=float, default=0.25)
    parser.add_argument("--retries", type=int, default=2)
    parser.add_argument("--request-timeout", type=float, default=20.0)
    parser.add_argument("--overrides", type=Path, default=DEFAULT_OVERRIDES)
    parser.add_argument("--apply", action="store_true", help="Escribe los IDs hallados en overrides.json (destino duradero)")
    parser.add_argument("--write-catalog", action="store_true", help="Legacy: muta tracks.json (el build lo sobrescribe)")
    parser.add_argument("--skip-misses-file", type=Path, default=None, help="JSON list of keys that already missed in this probe pass")
    return parser.parse_args(argv)


def read_skip_keys(path: Path | None) -> set[str]:
    if not path or not path.exists():
        return set()
    try:
        payload = json.loads(path.read_text(encoding="utf-8-sig"))
    except json.JSONDecodeError:
        return {line.strip() for line in path.read_text(encoding="utf-8").splitlines() if line.strip()}
    if isinstance(payload, list):
        return {str(item) for item in payload if item}
    return set()


def write_skip_keys(path: Path | None, keys: set[str]) -> None:
    if not path:
        return
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(sorted(keys), ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def main(argv: list[str]) -> int:
    args = parse_args(argv)
    args.catalog = args.catalog.resolve()
    args.charts_dir = args.charts_dir.resolve()
    args.report = args.report.resolve()

    original_request = requests.sessions.Session.request

    def request_with_timeout(self: requests.Session, method: str, url: str, **kwargs: Any) -> requests.Response:
        kwargs.setdefault("timeout", args.request_timeout)
        return original_request(self, method, url, **kwargs)

    requests.sessions.Session.request = request_with_timeout

    try:
        from ytmusicapi import YTMusic
    except ImportError:
        print("ytmusicapi is not installed. Install it in the venv first.", file=sys.stderr)
        return 2

    data, tracks = load_catalog(args.catalog)
    usage = load_usage(args.charts_dir)
    skip_keys = read_skip_keys(args.skip_misses_file)
    search_filters = [
        item.strip()
        for item in str(args.search_filters or "videos").split(",")
        if item.strip()
    ] or ["videos"]
    missing = [
        (track, usage.get(track.get("id"), {"chartIds": [], "years": [], "bestRank": 9999, "uses": 0}))
        for track in tracks
        if not has_good_video_id(track) and str(track.get("key") or "") not in skip_keys
    ]
    missing.sort(key=priority_key)
    selected = missing[: max(0, args.limit)]

    ytmusic = YTMusic()
    updates: list[dict[str, Any]] = []
    misses: list[dict[str, Any]] = []
    errors: list[dict[str, Any]] = []
    before_with_video = sum(1 for t in tracks if has_good_video_id(t))

    for idx, (track, use) in enumerate(selected, start=1):
        candidates_by_id: dict[str, dict[str, Any]] = {}
        provider_errors: list[str] = []
        for search_filter in search_filters:
            for query in query_variants(track)[: max(1, args.variant_limit)]:
                items, error = search_items(ytmusic, query, search_filter, args.max_results, args.retries)
                if error:
                    provider_errors.append(f"{search_filter}:{query}: {error}")
                for rank, item in enumerate(items):
                    raw = as_raw(item)
                    if not VIDEO_ID_RE.match(raw["video_id"]) or too_long(item, track):
                        continue
                    scored = score_candidate(raw, track, rank, f"ytmusic:{search_filter}")
                    if not scored:
                        continue
                    if search_filter == "songs" and strict_song_match(raw, track):
                        scored.score = max(scored.score, args.min_score + 0.5)
                    current = candidates_by_id.get(scored.video_id)
                    if current is None or scored.score > current["candidate"].score:
                        candidates_by_id[scored.video_id] = {
                            "candidate": scored,
                            "duration": item.get("duration"),
                            "views": item.get("views"),
                            "query": f"{search_filter}:{query}",
                        }
                if args.sleep:
                    time.sleep(args.sleep)

        candidates = sorted(
            candidates_by_id.values(),
            key=lambda row: (-row["candidate"].score, row["candidate"].source_rank),
        )
        best = candidates[0]["candidate"] if candidates and candidates[0]["candidate"].score >= args.min_score else None
        row = {
            "id": track.get("id"),
            "key": track.get("key"),
            "title": track.get("title"),
            "artist": track.get("artist"),
            "usage": use,
            "providerErrors": provider_errors,
            "candidates": [
                {
                    **entry["candidate"].as_dict(),
                    "duration": entry.get("duration"),
                    "views": entry.get("views"),
                    "query": entry.get("query"),
                }
                for entry in candidates[:10]
            ],
        }
        if provider_errors:
            errors.append({"id": track.get("id"), "errors": provider_errors})
        if best:
            track["youtubeVideoId"] = best.video_id
            row["youtubeVideoId"] = best.video_id
            row["selected"] = best.as_dict()
            updates.append(row)
            print(f"[{idx}/{len(selected)}] OK {track.get('artist')} - {track.get('title')} -> {best.video_id} ({best.score})", flush=True)
        else:
            misses.append(row)
            print(f"[{idx}/{len(selected)}] MISS {track.get('artist')} - {track.get('title')}", flush=True)

    backup_path = None
    overrides_path = None
    if args.apply and updates and args.write_catalog:
        OUT.mkdir(parents=True, exist_ok=True)
        backup_path = OUT / f"tracks.before_ytmusic_probe.{datetime.now().strftime('%Y%m%d_%H%M%S')}.json"
        shutil.copy2(args.catalog, backup_path)
        args.catalog.write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    if args.apply and updates:
        overrides_path = args.overrides.resolve()
        merge_youtube_overrides(overrides_path, updates)
    if args.apply and misses and args.skip_misses_file:
        skip_keys.update(str(row.get("key")) for row in misses if row.get("key"))
        write_skip_keys(args.skip_misses_file.resolve(), skip_keys)

    after_with_video = sum(1 for t in tracks if has_good_video_id(t))
    report = {
        "checkedAt": utc_now(),
        "catalog": str(args.catalog),
        "source": "ytmusic",
        "searchFilters": search_filters,
        "apply": args.apply,
        "totalTracks": len(tracks),
        "withYoutubeBefore": before_with_video,
        "missingYoutubeBefore": len(tracks) - before_with_video,
        "withYoutubeAfter": after_with_video,
        "missingYoutubeAfter": len(tracks) - after_with_video,
        "eligibleMissing": len(missing),
        "processed": len(selected),
        "updated": len(updates),
        "stillMissing": len(misses),
        "backup": str(backup_path) if backup_path else None,
        "overrides": str(overrides_path) if overrides_path else None,
        "report": str(args.report),
        "errors": errors,
        "updates": updates,
        "misses": misses,
    }
    args.report.parent.mkdir(parents=True, exist_ok=True)
    args.report.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({k: report[k] for k in ("totalTracks", "withYoutubeBefore", "missingYoutubeBefore", "processed", "updated", "withYoutubeAfter", "missingYoutubeAfter", "apply", "backup", "report")}, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
