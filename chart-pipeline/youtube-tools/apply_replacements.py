#!/usr/bin/env python3
"""
Apply validated YouTube replacement IDs for failed playback-audit tracks.

Por defecto las correcciones se escriben en `chart-pipeline/overrides.json`
(`tracks[<key>].youtubeVideoId`), que es el único sitio que el build respeta de
forma duradera: regenerar el catálogo no las pierde. El modo `--write-catalog`
(legacy) muta `public/catalog/tracks.json` directamente — útil solo para iterar
en local, porque el siguiente build lo sobrescribe.

El modo por defecto es dry-run; usa `--apply` solo tras validar los candidatos
con `chart-pipeline/audit/playback-audit.mjs`.
"""

from __future__ import annotations

import argparse
import json
import shutil
import sys
from datetime import datetime
from pathlib import Path
from typing import Any

from enricher import DEFAULT_CATALOG


HERE = Path(__file__).resolve().parent
OUT = HERE / "out"
DEFAULT_OVERRIDES = HERE.parent / "overrides.json"
DEFAULT_CANDIDATES = OUT / "failure_candidates.json"
DEFAULT_PLAYBACK = OUT / "failure_candidates_playback.json"
DEFAULT_MANUAL_PLAYBACK = OUT / "failure_manual_candidates_playback.json"
DEFAULT_PLAN = OUT / "validated_replacements_plan.json"

# These were reviewed manually because the automatic score is low or the
# highest-scored candidate is a less appropriate version.
MANUAL_OVERRIDES = {
    424: {"videoId": "BJZMrqPVE4c", "reason": "Exact title; artist shortened from full chart credit."},
    462: {"videoId": "DjTK83pZB_c", "reason": "Exact title and artist in YouTube Music search; better than unrelated top video."},
    500: {"videoId": "VP_SY-4mMSc", "reason": "Keeps Ghostface Killah feature instead of no-rap radio version."},
    571: {"videoId": "VLHziTKM2WQ", "reason": "Original Tripping track instead of later XXV version."},
    767: {"videoId": "UkstN3oeVdo", "reason": "Exact Spanish title Venus Y Baco."},
    808: {"videoId": "MTi2_ILGVfU", "reason": "Radio version without extra featured artists."},
    1113: {"videoId": "UpjqmklVccY", "reason": "YouTube Music song result for Ay Haiti!."},
    1730: {"videoId": "iNuzItDz048", "reason": "YouTube Music song result for Supergirl radio edit."},
    2176: {"videoId": "FHPqjhxb8eQ", "reason": "Madism Radio Mix matches catalog artist credit."},
    3174: {"videoId": "qZE0M2amDt8", "reason": "Original Eamon track; avoids Italian version false positive."},
    3800: {"videoId": "QdKIrntD6jg", "reason": "YouTube Music song result for A$AP Rocky F**kin' Problems."},
}

# No reliable Lexter result was found. Searches returned other artists or a
# different Lexter song ("Spanish Rose"), so this is intentionally left unset.
SKIP_IDS = {
    525: "No reliable Lexter - Spanish eyes candidate found.",
}


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--catalog", type=Path, default=DEFAULT_CATALOG)
    parser.add_argument("--candidates", type=Path, default=DEFAULT_CANDIDATES)
    parser.add_argument("--playback", type=Path, action="append", default=[DEFAULT_PLAYBACK, DEFAULT_MANUAL_PLAYBACK])
    parser.add_argument("--plan", type=Path, default=DEFAULT_PLAN)
    parser.add_argument("--overrides", type=Path, default=DEFAULT_OVERRIDES)
    parser.add_argument("--min-score", type=float, default=18.0)
    parser.add_argument("--apply", action="store_true")
    parser.add_argument(
        "--write-catalog",
        action="store_true",
        help="Legacy: mutar tracks.json en vez de overrides.json (el build lo sobrescribe).",
    )
    return parser.parse_args(argv)


def read_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def write_json(path: Path, data: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def validation_map(paths: list[Path]) -> dict[str, dict[str, Any]]:
    out: dict[str, dict[str, Any]] = {}
    for path in paths:
        if not path.exists():
            continue
        payload = read_json(path)
        for row in payload.get("results", []):
            video_id = row.get("youtubeVideoId")
            if video_id:
                out[str(video_id)] = row
    return out


def compact_catalog(data: Any) -> str:
    return json.dumps(data, ensure_ascii=False, separators=(",", ":"))


def merge_into_overrides(overrides_path: Path, updates: list[dict[str, Any]], tracks_by_id: dict[int, Any]) -> int:
    """Escribe cada corrección en overrides.json bajo tracks[<key>].youtubeVideoId.

    La key es la `makeCacheKey` del track (presente en el catálogo). Preserva el
    resto del fichero y deja las pistas ordenadas para diffs estables.
    """
    overrides = read_json(overrides_path) if overrides_path.exists() else {}
    tracks_ov = overrides.setdefault("tracks", {})
    applied = 0
    for update in updates:
        track = tracks_by_id[int(update["id"])]
        key = track.get("key")
        if not key:
            continue
        tracks_ov.setdefault(key, {})["youtubeVideoId"] = update["newYoutubeVideoId"]
        applied += 1
    overrides["tracks"] = dict(sorted(tracks_ov.items()))
    write_json(overrides_path, overrides)
    return applied


def choose_candidate(row: dict[str, Any], validations: dict[str, dict[str, Any]], min_score: float) -> tuple[dict[str, Any] | None, str]:
    track_id = int(row["id"])
    if track_id in SKIP_IDS:
        return None, SKIP_IDS[track_id]

    manual = MANUAL_OVERRIDES.get(track_id)
    if manual:
        video_id = manual["videoId"]
        validation = validations.get(video_id)
        if validation and validation.get("ok"):
            candidate = next((c for c in row.get("candidates", []) if c.get("videoId") == video_id), None) or {
                "videoId": video_id,
                "score": None,
                "title": None,
                "channel": None,
            }
            return {**candidate, "manual": True, "manualReason": manual["reason"]}, "manual"
        return None, f"Manual override {video_id} was not validated OK."

    for candidate in row.get("candidates", []):
        video_id = str(candidate.get("videoId") or "")
        validation = validations.get(video_id)
        if validation and validation.get("ok") and float(candidate.get("score") or 0) >= min_score:
            return candidate, "auto"
    return None, "No validated candidate above threshold."


def main(argv: list[str]) -> int:
    args = parse_args(argv)
    args.catalog = args.catalog.resolve()
    args.candidates = args.candidates.resolve()
    args.playback = [path.resolve() for path in args.playback]
    args.plan = args.plan.resolve()

    candidates = read_json(args.candidates)
    validations = validation_map(args.playback)
    catalog = read_json(args.catalog)
    tracks_by_id = {int(track["id"]): track for track in catalog.get("tracks", []) if "id" in track}

    updates: list[dict[str, Any]] = []
    unresolved: list[dict[str, Any]] = []
    for row in candidates.get("rows", []):
        track_id = int(row["id"])
        selected, reason = choose_candidate(row, validations, args.min_score)
        track = tracks_by_id[track_id]
        if selected:
            updates.append(
                {
                    "id": track_id,
                    "artist": row.get("artist"),
                    "title": row.get("title"),
                    "oldYoutubeVideoId": track.get("youtubeVideoId"),
                    "newYoutubeVideoId": selected.get("videoId"),
                    "selection": reason,
                    "score": selected.get("score"),
                    "candidateTitle": selected.get("title"),
                    "candidateChannel": selected.get("channel"),
                    "candidateDuration": selected.get("duration"),
                    "manualReason": selected.get("manualReason"),
                }
            )
        else:
            unresolved.append(
                {
                    "id": track_id,
                    "artist": row.get("artist"),
                    "title": row.get("title"),
                    "currentYoutubeVideoId": track.get("youtubeVideoId"),
                    "reason": reason,
                }
            )

    plan = {
        "catalog": str(args.catalog),
        "candidateReport": str(args.candidates),
        "playbackReports": [str(path) for path in args.playback],
        "minScore": args.min_score,
        "updates": updates,
        "unresolved": unresolved,
        "summary": {
            "updates": len(updates),
            "unresolved": len(unresolved),
        },
    }
    write_json(args.plan, plan)

    if args.apply and args.write_catalog:
        stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        backup = args.catalog.with_name(f"{args.catalog.stem}.before_validated_playback_fixes.{stamp}{args.catalog.suffix}")
        shutil.copy2(args.catalog, backup)
        for update in updates:
            tracks_by_id[int(update["id"])]["youtubeVideoId"] = update["newYoutubeVideoId"]
        args.catalog.write_text(compact_catalog(catalog), encoding="utf-8")
        print(f"applied {len(updates)} updates to catalog (legacy; el build lo sobrescribe)")
        print(f"backup {backup}")
    elif args.apply:
        applied = merge_into_overrides(args.overrides.resolve(), updates, tracks_by_id)
        print(f"applied {applied} updates to overrides.json")
        print(f"overrides {args.overrides.resolve()}")
    else:
        print(f"dry-run: {len(updates)} updates, {len(unresolved)} unresolved")
    print(f"plan {args.plan}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
