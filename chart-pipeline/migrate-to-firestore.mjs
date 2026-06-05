#!/usr/bin/env node
// Migra una fuente de charts SQLite → Firestore (colecciones chart_periods +
// chart_registry) en el formato ANUAL de TuaFM. Usa la MISMA consolidación que
// el exportador estático (lib/annualize.mjs) → 1 documento por año y chart
// (lecturas/cuota mínimas). No se ejecuta en el flujo local; queda alineado para
// activar Firebase "más adelante".
//
// Uso:  node migrate-to-firestore.mjs chart-configs/es.json [--from 2000] [--to 2025]
// Deps: npm install   (firebase-admin, better-sqlite3 — ver package.json)
// Auth: coloca un service-account.json de Firebase junto a este script.

import { initializeApp, cert } from 'firebase-admin/app'
import { getFirestore }        from 'firebase-admin/firestore'
import Database                from 'better-sqlite3'
import { readFileSync, existsSync } from 'node:fs'
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
  console.error('Uso: node migrate-to-firestore.mjs <chart-config.json> [--from 2000] [--to 2025]')
  process.exit(1)
}

const config   = JSON.parse(readFileSync(resolve(__dir, configArg), 'utf8'))
const svcPath  = resolve(__dir, 'service-account.json')
if (!existsSync(svcPath)) {
  console.error('Falta service-account.json junto al script. Descárgalo de la consola de Firebase.')
  process.exit(1)
}
initializeApp({ credential: cert(JSON.parse(readFileSync(svcPath, 'utf8'))) })
const db_fs = getFirestore()

const dbPath = resolve(__dir, config.source.dbPath)
if (!existsSync(dbPath)) {
  console.error(`No se encuentra la base de datos SQLite: ${dbPath}`)
  process.exit(1)
}
const db_sql  = new Database(dbPath, { readonly: true })
const rows    = db_sql.prepare(config.source.query).all()
const periods = annualizeRows(rows, config, fromYear, toYear)
db_sql.close()

if (periods.length === 0) {
  console.error(`Sin períodos en el rango ${fromYear}–${toYear}.`)
  process.exit(1)
}

console.log(`${config.chartId}: ${periods.length} años a migrar (${rows.length} filas leídas)`)

const BATCH = 400
let batch = db_fs.batch()
let count = 0
for (const period of periods) {
  const ref = db_fs.collection('chart_periods').doc(`${config.chartId}_${period.year}`)
  batch.set(ref, period, { merge: false })
  if (++count % BATCH === 0) { await batch.commit(); batch = db_fs.batch() }
}
await batch.commit()

const minYear = Math.min(...periods.map(p => p.year))
const maxYear = Math.max(...periods.map(p => p.year))
console.log(`✓ ${count} años subidos (${minYear}–${maxYear})`)

await db_fs.collection('chart_registry').doc(config.chartId).set({
  chartId: config.chartId, name: config.name, shortName: config.shortName,
  subtitle: config.subtitle ?? null, country: config.country, flag: config.flag,
  language: config.language, listSize: config.listSize,
  defaultLambda: config.defaultLambda, description: config.description,
  startYear: minYear, endYear: maxYear, totalPeriods: count
}, { merge: true })

console.log(`✓ chart_registry/${config.chartId} actualizado`)
