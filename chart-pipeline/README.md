# chart-pipeline

Tooling **versionado** que consolida los charts a un **Top por año**, construye un
**catálogo normalizado** (tracks + artistas, pre-cacheado con Last.fm) y genera el
bundle estático que consume la app. (Los scrapers en Python viven en
[`../charts-db/`](../charts-db/); las bases `.db` que producen van a
[`../data/`](../data/), no versionadas.)

## Qué hay aquí

| Archivo | Para qué |
|---|---|
| [`lib/annualize.mjs`](lib/annualize.mjs) | Consolidación pura (semanal/anual → Top del año). **Único sitio** para afinar la fórmula de puntuación. |
| [`lib/catalog.mjs`](lib/catalog.mjs) | Dedupe de tracks/artistas, asignación de ids, siembra desde la DB y compactación de los charts. |
| [`lib/lastfm.mjs`](lib/lastfm.mjs) | Cliente Last.fm para el build (throttle ~5 req/s + caché de reanudación en `.lastfm-cache.db`). |
| [`lib/deezer.mjs`](lib/deezer.mjs) | Artwork y duración como respaldo cuando Last.fm no los trae. Caché en `.deezer-cache.db`. |
| [`build-charts.mjs`](build-charts.mjs) | Orquestador: charts compactos en `../public/charts/` + catálogo en `../public/catalog/`. |
| [`chart-configs/*.json`](chart-configs/) | Definición de cada fuente (consulta SQL, `consolidate`, metadatos del registry). |
| [`overrides.json`](overrides.json) | Correcciones manuales que ganan sobre lo generado (ver más abajo). |
| [`audit/`](audit/) | Auditoría de reproducción de YouTube (Node + Playwright) sobre el bundle. |
| [`youtube-tools/`](youtube-tools/) | Descubrimiento/QA de `youtubeVideoId` (Python); sus `--apply` escriben en `overrides.json`. |

## Salida

- `../public/charts/registry.json` — índice de listas.
- `../public/charts/<chartId>.json` — **compacto**: cada canción es `{t,r,s,p,w}`
  (t=trackId, r=rank, s=score, p=pico, w=semanas) y referencia el catálogo.
- `../public/catalog/tracks.json` — 1 entrada por track distinto (deduplicado entre
  años y charts), con YouTube + álbum/tags/duración/oyentes de Last.fm. `coverUrl`
  solo se guarda si la URL viene de Last.fm o Deezer.
- `../public/catalog/artists.json` — 1 entrada por artista: bio, oyentes, tags y
  **top 50** de Last.fm. `imageUrl` solo se guarda si la URL viene de Last.fm o Deezer.
  Lo que no se encuentra se deja vacío.

Carátulas y fotos de artista: **Last.fm primero, Deezer como fallback**. No se
guardan URLs de Prisa, FIMI/SNEP, Cover Art Archive ni fuentes sembradas por DB.

## Requisitos

Las bases SQLite de origen viven en `../data/` (ver `dbPath` de cada
`chart-configs/*.json`): `../data/los40.db`, `../data/billboard_year_end_hot100.db`,
`../data/italy_year_end_singles.db`. No se versionan. El enriquecimiento Last.fm
necesita `VITE_LASTFM_API_KEY` (del entorno o de `../.env.local`).

## Uso

```bash
# Build INCREMENTAL por defecto: reutiliza lo ya enriquecido en public/catalog y
# solo pega a la API por las pistas/artistas NUEVOS. Añadir una lista cuesta minutos,
# no ~25 min, y nunca regresiona datos buenos (el catálogo versionado es la caché).
node build-charts.mjs                 # = npm run build

# Re-enriquecer TODO desde cero (ignora el catálogo previo; ~25 min la 1ª vez,
# resumible vía .lastfm-cache.db dentro de la misma máquina):
node build-charts.mjs --refresh

# Build rápido sin tocar la API (solo siembra de la DB: YouTube/carátula/álbum):
node build-charts.mjs --no-lastfm     # = npm run build:fast

# Acotar años:  node build-charts.mjs --from 2000 --to 2025
```

## Correcciones manuales (`overrides.json`)

El build **sobrescribe** el catálogo, así que **no edites `public/catalog/*.json` a
mano** (se perderían al regenerar). En su lugar, pon tus correcciones en
[`overrides.json`](overrides.json): se aplican **al final** del build y **ganan**
sobre lo generado (Last.fm/DB). Está versionado.

```jsonc
{
  "tracks":  { "<key>": { "coverUrl": "…", "youtubeVideoId": "…", "title": "…" } },
  "artists": { "<key>": { "imageUrl": "…", "bio": "…" } }
}
// key de track  = "<artista normalizado>::<título normalizado>"  (= makeCacheKey)
// key de artista = "<nombre normalizado>"
// Solo los campos presentes se sobrescriben; el resto se mantiene generado.
```

Los overrides de `coverUrl` e `imageUrl` se sanitizan al final: si no apuntan a
Last.fm o Deezer, se descartan.

El algoritmo (fórmula `score = Σ 1/√posición`, equilibrio pico/permanencia y cómo
afinarlo) está documentado en el [README raíz](../README.md#algoritmo-de-consolidación-semanal--top-del-año).
