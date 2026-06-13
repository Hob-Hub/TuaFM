# data/ — bases SQLite de origen (no versionadas)

Aquí van las `.db` por país que produce el proyecto de scraping
(`charts-db/`, que vivirá en un repo aparte). **Los `.db` no se suben a git**
(ver `.gitignore`); este README sí, porque **es el contrato** entre el scraper y
el pipeline.

```
data/
  los40.db                      → chart "es"  (España, LOS40 — semanal)
  billboard_year_end_hot100.db  → chart "us"  (Billboard Year-End — anual)
  italy_year_end_singles.db     → chart "it"  (FIMI — anual)
  france_year_end_singles.db    → chart "fr"  (SNEP — anual, pendiente de wiring)
```

Las consume [`chart-pipeline/build-charts.mjs`](../chart-pipeline/build-charts.mjs)
vía el `dbPath` de cada [`chart-configs/*.json`](../chart-pipeline/chart-configs/)
(p. ej. `"../data/los40.db"`).

## Contrato: la vista `v_chart`

El pipeline **no conoce el esquema interno** de cada `.db`: solo lee una vista
`v_chart` (una fila por entrada de chart). Cada scraper es libre de modelar sus
tablas como quiera mientras exponga esta vista con, **como mínimo**, estas
columnas:

| Columna       | Tipo   | Obligatoria | Notas                                                        |
|---------------|--------|:-----------:|--------------------------------------------------------------|
| `chart_date`  | TEXT   | ✓           | ISO `YYYY-MM-DD`. El pipeline toma el **año** de aquí.        |
| `position`    | INTEGER| ✓           | Rank (anual) o posición (semanal). ≥ 1.                      |
| `song`        | TEXT   | ✓           | Título de la canción.                                         |
| `artists`     | TEXT   | ✓           | Artistas unidos por `; ` (separador configurable por chart). |
| `cover_url`   | TEXT   | –           | URL de carátula. `NULL` si no hay.                           |
| `youtube_url` | TEXT   | –           | URL/embed de YouTube. `NULL` si no hay.                      |
| `album`       | TEXT   | –           | Solo fuentes que lo traen (hoy: ES).                        |
| `album_year`  | INTEGER| –           | Solo fuentes que lo traen (hoy: ES).                        |

Las columnas opcionales se mapean en `source.*Field` del chart-config; si una
fuente no las tiene, se omite el campo en el config y el pipeline las trata como
ausentes. Cada `.db` puede exponer **muchas más** columnas (movimiento, labels,
enlaces a otras tiendas, ids internos…): el pipeline simplemente las ignora.

### Fuentes semanales vs anuales

- **Semanal** (ES): `v_chart` tiene una fila por canción **y semana**. El config
  usa `"consolidate": "annual-from-weekly"` y el pipeline agrega el año con
  `Σ 1/√posición`.
- **Anual** (US, IT, FR): `v_chart` ya trae una fila por canción **y año**. El
  config usa `"consolidate": "annual"`.

## Cómo se rellena

1. Generas las `.db` con `charts-db/` (scrapers Python).
2. Las copias a esta carpeta con el nombre que espera el config.
3. `cd chart-pipeline && npm run build` regenera `public/charts` y `public/catalog`.
