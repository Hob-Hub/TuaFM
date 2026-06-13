#!/usr/bin/env python3
"""Validate YouTube IDs used by public/charts/es.json via YouTube oEmbed."""

from __future__ import annotations

import json
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from typing import Any

import requests


HERE = Path(__file__).resolve().parent
OUT = HERE / "out"
ROOT = Path(__file__).resolve().parents[2]
CATALOG = ROOT / "public" / "catalog" / "tracks.json"
ES_CHART = ROOT / "public" / "charts" / "es.json"
REPORT = OUT / "es_oembed_validation.json"


def load_es_tracks() -> list[dict[str, Any]]:
    tracks = json.loads(CATALOG.read_text(encoding="utf-8"))["tracks"]
    chart = json.loads(ES_CHART.read_text(encoding="utf-8"))
    indexes = sorted({song["t"] for period in chart["periods"] for song in period["songs"]})
    return [tracks[index] for index in indexes]


def validate(track: dict[str, Any]) -> dict[str, Any]:
    video_id = track.get("youtubeVideoId")
    row = {
        "id": track.get("id"),
        "artist": track.get("artist"),
        "title": track.get("title"),
        "youtubeVideoId": video_id,
        "ok": False,
        "status": None,
        "oembedTitle": None,
        "author": None,
        "error": None,
    }
    if not video_id:
        row["error"] = "missing-youtubeVideoId"
        return row

    url = "https://www.youtube.com/oembed"
    params = {"url": f"https://www.youtube.com/watch?v={video_id}", "format": "json"}
    try:
        response = requests.get(url, params=params, timeout=15, headers={"User-Agent": "Mozilla/5.0"})
        row["status"] = response.status_code
        if response.ok:
            payload = response.json()
            row["ok"] = True
            row["oembedTitle"] = payload.get("title")
            row["author"] = payload.get("author_name")
        else:
            row["error"] = response.text[:300]
    except Exception as exc:
        row["error"] = f"{type(exc).__name__}: {exc}"
    return row


def main() -> int:
    tracks = load_es_tracks()
    started = time.time()
    rows: list[dict[str, Any]] = []
    with ThreadPoolExecutor(max_workers=16) as pool:
        futures = [pool.submit(validate, track) for track in tracks]
        for index, future in enumerate(as_completed(futures), start=1):
            rows.append(future.result())
            if index % 250 == 0 or index == len(futures):
                print(f"validated {index}/{len(futures)}", flush=True)

    rows.sort(key=lambda row: int(row.get("id") or 0))
    failures = [row for row in rows if not row["ok"]]
    report = {
        "checkedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "chart": "es",
        "totalTracks": len(rows),
        "ok": len(rows) - len(failures),
        "failures": len(failures),
        "elapsedSeconds": round(time.time() - started, 2),
        "failedTracks": failures,
        "rows": rows,
    }
    REPORT.parent.mkdir(parents=True, exist_ok=True)
    REPORT.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({k: report[k] for k in ("totalTracks", "ok", "failures", "elapsedSeconds")}, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
