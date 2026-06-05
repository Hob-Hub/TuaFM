#!/usr/bin/env node
// Exporta una fuente de charts SQLite → JSON estático ANUAL (mismo formato que
// las colecciones Firestore chart_periods + chart_registry) para que la app
// pueda generar radios sin depender de Firebase.
//
// Cada chart se consolida a UN período por año (Top del año puntuado). La lógica
// de consolidación vive en lib/annualize.mjs (compartida con migrate-to-firestore).
//
// Salida:
//   public/charts/registry.json      → ChartRegistry[]  (índice de charts locales)
//   public/charts/<chartId>.json     → { chartId, periods: ChartPeriod[] }
//
// Uso:  node export-charts-static.mjs chart-configs/es.json
//       node export-charts-static.mjs chart-configs/us.json --from 2000 --to 2025
// Deps: ninguna — usa node:sqlite (Node >= 22).

import { DatabaseSync }        from 'node:sqlite'
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { resolve, dirname }    from 'node:path'
import { fileURLToPath }       from 'node:url'
import { annualizeRows }       from './lib/annualize.mjs'

const __dir = dirname(fileURLToPath(import.meta.url))

const args      = process.argv.slice(2)
const configArg = args.find(a => !a.startsWith('--'))
const getFlag   = (name, def) => {
  const i = args.indexOf(`--${name}`)
  return i >= 0 && args[i + 1] ? Number(args[i + 1]) : def
}
const fromYear = getFlag('from', 2000)
const toYear   = getFlag('to', 2025)

if (!configArg) {
  console.error('Uso: node export-charts-static.mjs <chart-config.json> [--from 2000] [--to 2025]')
  process.exit(1)
}

const config = JSON.parse(readFileSync(resolve(__dir, configArg), 'utf8'))
const dbPath = resolve(__dir, config.source.dbPath)
if (!existsSync(dbPath)) {
  console.error(`No se encuentra la base de datos SQLite: ${dbPath}`)
  process.exit(1)
}
const db_sql = new DatabaseSync(dbPath, { readOnly: true })

// ── Lectura + consolidación anual ────────────────────────────────────────────
const rows    = db_sql.prepare(config.source.query).all()
const periods = annualizeRows(rows, config, fromYear, toYear)
db_sql.close()

if (periods.length === 0) {
  console.error(`Sin períodos en el rango ${fromYear}–${toYear}. ¿Rango correcto?`)
  process.exit(1)
}

const minYear = Math.min(...periods.map(p => p.year))
const maxYear = Math.max(...periods.map(p => p.year))

// ── Escritura de los JSON estáticos ──────────────────────────────────────────
const outDir = resolve(__dir, '..', 'public', 'charts')
mkdirSync(outDir, { recursive: true })

const registryEntry = {
  chartId:       config.chartId,
  name:          config.name,
  shortName:     config.shortName,
  subtitle:      config.subtitle ?? null,
  country:       config.country,
  flag:          config.flag,
  language:      config.language,
  listSize:      config.listSize,          // tamaño "mostrado" (p. ej. 100)
  startYear:     minYear,
  endYear:       maxYear,
  totalPeriods:  periods.length,
  defaultLambda: config.defaultLambda,
  description:   config.description
}

// registry.json es un índice acumulativo: conserva otros charts ya exportados.
const registryPath = resolve(outDir, 'registry.json')
let registry = []
if (existsSync(registryPath)) {
  try { registry = JSON.parse(readFileSync(registryPath, 'utf8')) } catch { registry = [] }
}
registry = registry.filter(r => r.chartId !== config.chartId)
registry.push(registryEntry)
registry.sort((a, b) => a.chartId.localeCompare(b.chartId))
writeFileSync(registryPath, JSON.stringify(registry))

const chartPath = resolve(outDir, `${config.chartId}.json`)
writeFileSync(chartPath, JSON.stringify({ chartId: config.chartId, periods }))

const songCount = periods.reduce((n, p) => n + p.songs.length, 0)
const sizeKb    = (readFileSync(chartPath).length / 1024).toFixed(0)
console.log(`✓ ${config.chartId}: ${periods.length} años (${minYear}–${maxYear}), ${songCount} entradas → ${chartPath} (${sizeKb} KB)`)
console.log(`✓ registry.json actualizado (${registry.length} chart(s))`)
