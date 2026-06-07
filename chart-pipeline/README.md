# chart-pipeline

Tooling **versionado** que consolida los charts a un **Top por año**, construye un
**catálogo normalizado** (tracks + artistas, pre-cacheado con Last.fm) y genera el
bundle estático que consume la app. (El scraper en Python y las bases `.db` viven
en `scripts/`, que está en `.gitignore`.)

## Qué hay aquí

| Archivo | Para qué |
|---|---|
| [`lib/annualize.mjs`](lib/annualize.mjs) | Consolidación pura (semanal/anual → Top del año). **Único sitio** para afinar la fórmula de puntuación. |
| [`lib/catalog.mjs`](lib/catalog.mjs) | Dedupe de tracks/artistas, asignación de ids, siembra desde la DB y compactación de los charts. |
| [`lib/lastfm.mjs`](lib/lastfm.mjs) | Cliente Last.fm para el build (throttle ~5 req/s + caché de reanudación en `.lastfm-cache.db`). |
| [`lib/deezer.mjs`](lib/deezer.mjs) | Imágenes de artista desde Deezer (Last.fm ya no las sirve). Caché en `.deezer-cache.db`. |
| [`build-charts.mjs`](build-charts.mjs) | Orquestador: charts compactos en `../public/charts/` + catálogo en `../public/catalog/`. |
| [`migrate-to-firestore.mjs`](migrate-to-firestore.mjs) | SQLite → Firestore (1 doc/año/chart). Para "más adelante"; necesita `npm install`. |
| [`chart-configs/*.json`](chart-configs/) | Definición de cada fuente (consulta SQL, `consolidate`, metadatos del registry). |

## Salida

- `../public/charts/registry.json` — índice de listas.
- `../public/charts/<chartId>.json` — **compacto**: cada canción es `{t,r,s,p,w}`
  (t=trackId, r=rank, s=score, p=pico, w=semanas) y referencia el catálogo.
- `../public/catalog/tracks.json` — 1 entrada por track distinto (deduplicado entre
  años y charts), con YouTube/carátula de la DB + álbum/tags/duración/oyentes de Last.fm.
- `../public/catalog/artists.json` — 1 entrada por artista: bio, oyentes, tags y
  **top 50** de Last.fm, e **imagen de Deezer** (Last.fm no sirve fotos de artista).
  Lo que no se encuentra se deja vacío.

Carátulas: se prefiere la de **Last.fm** (álbum); la de `los40.db` queda de fallback.

## Requisitos

Las bases SQLite de origen deben estar en la **raíz del repo** (un nivel por
encima de esta carpeta): `../los40.db`, `../billboard_year_end_hot100.db`. No se
versionan. El enriquecimiento Last.fm necesita `VITE_LASTFM_API_KEY` (del entorno
o de `../.env.local`).

## Uso

```bash
# Build completo (charts + catálogo enriquecido con Last.fm). Resumible: la caché
# .lastfm-cache.db evita repetir llamadas en pasadas sucesivas (~25 min la 1ª vez).
node build-charts.mjs                 # = npm run build

# Build rápido sin tocar la API (solo siembra de la DB: YouTube/carátula/álbum):
node build-charts.mjs --no-lastfm     # = npm run build:fast

# Acotar años:  node build-charts.mjs --from 2000 --to 2025

# Subir a Firestore (opcional, "más adelante"):
npm install                                  # better-sqlite3, firebase-admin
# coloca service-account.json en esta carpeta
node migrate-to-firestore.mjs chart-configs/es.json
node migrate-to-firestore.mjs chart-configs/us.json
```

El algoritmo (fórmula `score = Σ 1/√posición`, equilibrio pico/permanencia y cómo
afinarlo) está documentado en el [README raíz](../README.md#algoritmo-de-consolidación-semanal--top-del-año).
