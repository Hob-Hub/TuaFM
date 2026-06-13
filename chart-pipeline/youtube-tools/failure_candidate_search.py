#!/usr/bin/env python3
"""
Search YouTube Music candidates for tracks that failed the playback audit.

The script does not modify the catalog. It writes a candidate report that can
be validated with chart-pipeline/audit/playback-audit.mjs before any update is
applied.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
import time
from pathlib import Path
from typing import Any

import requests

from enricher import (
    DEFAULT_CATALOG,
    VIDEO_ID_RE,
    primary_artist_for_track,
    score_candidate,
)


HERE = Path(__file__).resolve().parent
OUT = HERE / "out"
ROOT = Path(__file__).resolve().parents[2]
DEFAULT_FAILURES = OUT / "playback_failures.json"
DEFAULT_REPORT = OUT / "failure_candidates.json"


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--catalog", type=Path, default=DEFAULT_CATALOG)
    parser.add_argument("--failures", type=Path, default=DEFAULT_FAILURES)
    parser.add_argument("--report", type=Path, default=DEFAULT_REPORT)
    parser.add_argument("--max-results", type=int, default=8)
    parser.add_argument("--max-candidates", type=int, default=10)
    parser.add_argument("--sleep", type=float, default=0.2)
    parser.add_argument("--request-timeout", type=float, default=20.0)
    parser.add_argument("--retries", type=int, default=2)
    return parser.parse_args(argv)


def read_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def write_json(path: Path, data: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def title_core(title: str) -> str:
    value = re.sub(r"[\[(].*?[\])]", " ", str(title or ""))
    return re.sub(r"\s+", " ", value).strip() or str(title or "").strip()


def primary_artist_text(track: dict[str, Any]) -> str:
    primary = primary_artist_for_track(track)
    return primary or str(track.get("artist") or "").split(",", 1)[0].strip()


def query_variants(track: dict[str, Any]) -> list[str]:
    artist = str(track.get("artist") or "").strip()
    primary = primary_artist_text(track)
    title = str(track.get("title") or "").strip()
    core = title_core(title)
    variants = [
        f"{artist} {title}",
        f"{primary} {title}",
        f"{title} {primary}",
        f"{artist} {core}",
        f"{primary} {core}",
        f"{title} official audio {primary}",
        f"{title} topic {primary}",
    ]
    out: list[str] = []
    seen: set[str] = set()
    for query in variants:
        query = re.sub(r"\s+", " ", query).strip()
        key = query.casefold()
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


def ytmusic_artists(item: dict[str, Any]) -> str:
    artists = item.get("artists") or []
    return ", ".join(str(a.get("name") or "") for a in artists if a.get("name"))


def search_with_retries(ytmusic: Any, query: str, filter_name: str, limit: int, retries: int) -> tuple[list[dict[str, Any]], str | None]:
    last_error: str | None = None
    for attempt in range(retries + 1):
        try:
            return ytmusic.search(query, filter=filter_name, limit=limit), None
        except Exception as exc:  # noqa: BLE001 - ytmusicapi errors are provider-specific.
            last_error = f"{type(exc).__name__}: {exc}"
            if attempt < retries:
                time.sleep(1 + attempt)
    return [], last_error


def adjusted_score(candidate: Any, item: dict[str, Any], track: dict[str, Any], filter_name: str) -> float:
    score = float(candidate.score)
    if filter_name == "songs":
        score += 3.0
    elif filter_name == "videos":
        score += 0.5

    duration = duration_seconds(item.get("duration"))
    requested_ms = track.get("durationMs")
    if duration and isinstance(requested_ms, int) and requested_ms > 0:
        requested_seconds = requested_ms / 1000
        delta = abs(duration - requested_seconds)
        if delta <= 8:
            score += 3.0
        elif delta <= 20:
            score += 2.0
        elif delta <= 45:
            score += 1.0
        elif delta >= 120:
            score -= 2.0

    title = str(item.get("title") or "").casefold()
    requested_title = str(track.get("title") or "").casefold()
    unwanted = ("karaoke", "tribute", "cover", "reaction", "tutorial", "sped up", "slowed")
    if any(word in title for word in unwanted):
        score -= 8.0
    if "acoustic" in title and "acoustic" not in requested_title:
        score -= 4.0
    if "live" in title and "live" not in requested_title and "directo" not in requested_title:
        score -= 3.0
    if "remix" in title and "remix" not in requested_title and "mix" not in requested_title:
        score -= 3.0
    return round(score, 3)


def main(argv: list[str]) -> int:
    args = parse_args(argv)
    args.catalog = args.catalog.resolve()
    args.failures = args.failures.resolve()
    args.report = args.report.resolve()

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

    catalog = read_json(args.catalog)
    tracks_by_id = {int(track["id"]): track for track in catalog.get("tracks", []) if "id" in track}
    failures = [
        row for row in read_json(args.failures).get("results", [])
        if not row.get("ok") and isinstance(row.get("id"), int)
    ]
    ytmusic = YTMusic()
    rows: list[dict[str, Any]] = []

    for index, failure in enumerate(failures, start=1):
        track = tracks_by_id[int(failure["id"])]
        current_id = str(track.get("youtubeVideoId") or "")
        by_id: dict[str, dict[str, Any]] = {}
        provider_errors: list[str] = []
        for query in query_variants(track):
            for filter_name in ("songs", "videos"):
                items, error = search_with_retries(ytmusic, query, filter_name, args.max_results, args.retries)
                if error:
                    provider_errors.append(f"{filter_name}:{query}: {error}")
                for rank, item in enumerate(items):
                    video_id = str(item.get("videoId") or "")
                    if not VIDEO_ID_RE.match(video_id) or video_id == current_id:
                        continue
                    duration = duration_seconds(item.get("duration"))
                    if duration is not None and duration > 900:
                        continue
                    raw = {
                        "video_id": video_id,
                        "title": str(item.get("title") or ""),
                        "channel": ytmusic_artists(item),
                    }
                    scored = score_candidate(raw, track, rank, f"ytmusic-{filter_name}")
                    if not scored:
                        continue
                    score = adjusted_score(scored, item, track, filter_name)
                    candidate = {
                        **scored.as_dict(),
                        "score": score,
                        "baseScore": scored.score,
                        "resultType": item.get("resultType"),
                        "duration": item.get("duration"),
                        "durationSeconds": duration,
                        "album": item.get("album", {}).get("name") if isinstance(item.get("album"), dict) else item.get("album"),
                        "query": query,
                        "filter": filter_name,
                    }
                    previous = by_id.get(video_id)
                    if previous is None or score > previous["score"]:
                        by_id[video_id] = candidate
                if args.sleep:
                    time.sleep(args.sleep)

        candidates = sorted(by_id.values(), key=lambda row: (-float(row["score"]), int(row.get("sourceRank") or 0)))
        rows.append(
            {
                "id": track.get("id"),
                "key": track.get("key"),
                "artist": track.get("artist"),
                "title": track.get("title"),
                "currentYoutubeVideoId": current_id or None,
                "failureStatus": failure.get("status"),
                "failureErrorCode": failure.get("errorCode"),
                "providerErrors": provider_errors,
                "candidates": candidates[: args.max_candidates],
            }
        )
        print(f"[{index}/{len(failures)}] {track.get('artist')} - {track.get('title')}: {len(candidates)} candidates")

    payload = {
        "sourceFailures": str(args.failures),
        "catalog": str(args.catalog),
        "total": len(rows),
        "rows": rows,
    }
    write_json(args.report, payload)
    print(f"wrote {args.report}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
