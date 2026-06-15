# youtube-tools

Descubrimiento y QA de los `youtubeVideoId` del **catálogo** (`public/catalog/
tracks.json`). Vive aquí, dentro de TuaFM, porque opera sobre la salida de la app
y escribe sus correcciones en [`../overrides.json`](../overrides.json) — el único
sitio que el build respeta de forma duradera.

Es Python a propósito: el descubrimiento se apoya en **ytmusicapi** y **yt-dlp**,
que no tienen equivalente serio en Node. La auditoría de reproducción (Playwright)
es Node y vive al lado, en [`../audit/`](../audit/).

## Instalación

```bash
cd chart-pipeline/youtube-tools
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
```

`enricher.py` (proveedor `api`) necesita `YOUTUBE_API_KEY` o `VITE_YOUTUBE_API_KEY`.

## El flujo correcto: las correcciones van a `overrides.json`

El build **sobrescribe** `public/catalog/tracks.json`, así que editarlo a mano (o
con `--write-catalog`) se pierde al regenerar. Por eso estas herramientas, con
`--apply`, escriben en `../overrides.json` bajo `tracks[<key>].youtubeVideoId`,
que el build aplica al final y **gana** sobre lo generado.

```
descubrir IDs ──> auditar reproducción ──> --apply (→ overrides.json) ──> rebuild
 enricher /        ../audit/                                              cd .. &&
 ytmusic_probe     playback-audit.mjs                                     npm run build
```

`--write-catalog` se mantiene solo para iterar en local (rápido, pero efímero).

## Herramientas

| Script | Para qué |
|---|---|
| `enricher.py` | Rellena `youtubeVideoId` ausentes (API de YouTube / yt-dlp). `--apply` → overrides. |
| `ytmusic_probe.py` | Igual, vía **ytmusicapi** (YouTube Music). `--apply` → overrides. |
| `full_catalog_review.py` | Revisa todo el catálogo contra búsquedas frescas de YouTube Music y propone reemplazos conservadores. `--apply` → overrides. |
| `failure_candidate_search.py` | Busca candidatos para pistas que fallaron la auditoría de reproducción. |
| `apply_replacements.py` | Aplica reemplazos ya validados. `--apply` → overrides; `--write-catalog` legacy. |
| `validate_oembed.py` | Valida vía oEmbed los IDs usados por `es.json`. |

Salidas de trabajo (reportes, caché, CSV) en `out/` (ignorado por git).

```bash
# Ejemplos (dry-run por defecto; --apply escribe en overrides.json)
python enricher.py --limit 50 --source auto
python enricher.py --limit 50 --source auto --apply
python ytmusic_probe.py --apply
python validate_oembed.py
```
