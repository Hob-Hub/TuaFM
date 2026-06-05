# chart-pipeline

Tooling **versionado** que consolida los charts a un **Top por año** y genera el
bundle estático que consume la app. (El scraper en Python y las bases `.db` viven
en `scripts/`, que está en `.gitignore`.)

## Qué hay aquí

| Archivo | Para qué |
|---|---|
| [`lib/annualize.mjs`](lib/annualize.mjs) | Lógica pura de consolidación (semanal/anual → Top del año). **Único sitio** para afinar la fórmula de puntuación. |
| [`export-charts-static.mjs`](export-charts-static.mjs) | SQLite → JSON estático en `../public/charts/`. Sin dependencias (usa `node:sqlite`, Node ≥ 22). |
| [`migrate-to-firestore.mjs`](migrate-to-firestore.mjs) | SQLite → Firestore (1 doc/año/chart). Para "más adelante"; necesita `npm install`. |
| [`chart-configs/*.json`](chart-configs/) | Definición de cada fuente (consulta SQL, `consolidate`, metadatos del registry). |

## Requisitos

Las bases SQLite de origen deben estar en la **raíz del repo** (un nivel por
encima de esta carpeta): `../los40.db`, `../billboard_year_end_hot100.db`. No se
versionan (son grandes y se regeneran con el scraper de `scripts/`).

## Uso

```bash
# Bundle estático local (offline, sin Firebase) — lo que usa la app:
node export-charts-static.mjs chart-configs/es.json   # --from 2000 --to 2025
node export-charts-static.mjs chart-configs/us.json
# o, con deps instaladas: npm run export:all

# Subir a Firestore (opcional, "más adelante"):
npm install                                  # better-sqlite3, firebase-admin
# coloca service-account.json en esta carpeta
node migrate-to-firestore.mjs chart-configs/es.json
node migrate-to-firestore.mjs chart-configs/us.json
```

El algoritmo (fórmula `score = Σ 1/√posición`, equilibrio pico/permanencia y cómo
afinarlo) está documentado en el [README raíz](../README.md#algoritmo-de-consolidación-semanal--top-del-año).
