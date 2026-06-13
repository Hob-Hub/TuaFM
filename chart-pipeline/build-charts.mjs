#!/usr/bin/env node
// Build del bundle de charts NORMALIZADO + catálogo (tracks/artistas) pre-cacheado.
//
// Salida:
//   public/charts/registry.json        → ChartRegistry[]
//   public/charts/<chartId>.json       → { chartId, periods:[{year,songs:[{t,r,s,p,w}]}] }  (compacto)
//   public/catalog/tracks.json         → { tracks:  CatalogTrack[]  }  (1 por track distinto)
//   public/catalog/artists.json        → { artists: CatalogArtist[] }  (top 15 inline)
//
// Uso:  node build-charts.mjs                       # ES + US, con enriquecimiento Last.fm
//       node build-charts.mjs --no-lastfm           # rápido: solo siembra de la DB
//       node build-charts.mjs --from 2000 --to 2025 chart-configs/es.json chart-configs/us.json
//
// Deps: ninguna para --no-lastfm (node:sqlite, Node ≥22). El enriquecimiento usa
// fetch global y VITE_LASTFM_API_KEY (env o ../.env.local).

import { DatabaseSync } from 'node:sqlite'
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { annualizeRows, normalizeStr, splitArtist } from './lib/annualize.mjs'
import { buildCatalog, compactPeriods, seedMapFromRows, applyOverrides } from './lib/catalog.mjs'
import * as lfm from './lib/lastfm.mjs'
import * as deezer from './lib/deezer.mjs'

const __dir = dirname(fileURLToPath(import.meta.url))
const args  = process.argv.slice(2)
const flag  = (name, def) => { const i = args.indexOf(`--${name}`); return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? Number(args[i + 1]) : def }
const noLastfm = args.includes('--no-lastfm')
const refresh  = args.includes('--refresh')   // re-enriquece TODO, ignorando el catálogo ya generado
const fromYear = flag('from', 2000)
const toYear   = flag('to', 2025)
const configArgs = args.filter(a => !a.startsWith('--') && !/^\d+$/.test(a))
const configs = configArgs.length ? configArgs : ['chart-configs/es.json', 'chart-configs/us.json', 'chart-configs/it.json', 'chart-configs/fr.json']

const stripLinks = html => String(html || '').replace(/<a\b[^>]*>.*?<\/a>/gi, '').replace(/\s+/g, ' ').trim()

// ── 1. Consolidar cada chart + sembrar álbum/año desde la DB ─────────────────
const charts = []
const registry = []
for (const configPath of configs) {
  const config = JSON.parse(readFileSync(resolve(__dir, configPath), 'utf8'))
  const dbPath = resolve(__dir, config.source.dbPath)
  if (!existsSync(dbPath)) { console.error(`No existe la DB: ${dbPath}`); process.exit(1) }

  const db = new DatabaseSync(dbPath, { readOnly: true })
  const rows = db.prepare(config.source.query).all()
  db.close()

  const periods   = annualizeRows(rows, config, fromYear, toYear)
  const seedByKey = seedMapFromRows(rows, { chartId: config.chartId, ...config.source }, normalizeStr, splitArtist)
  charts.push({ config, chartId: config.chartId, periods, seedByKey })

  const minYear = Math.min(...periods.map(p => p.year))
  const maxYear = Math.max(...periods.map(p => p.year))
  registry.push({
    chartId: config.chartId, name: config.name, shortName: config.shortName,
    subtitle: config.subtitle ?? null, country: config.country, flag: config.flag,
    language: config.language, listSize: config.listSize,
    startYear: minYear, endYear: maxYear, totalPeriods: periods.length,
    defaultLambda: config.defaultLambda, description: config.description
  })
  console.log(`· ${config.chartId}: ${periods.length} años (${minYear}–${maxYear})`)
}

// ── 2. Catálogo normalizado (dedupe + ids + siembra) ─────────────────────────
const { tracks, artists, trackIdByKey, trackAliases, artistAliases } = buildCatalog(charts)
console.log(`· catálogo: ${tracks.length} tracks, ${artists.length} artistas`)
console.log(`· alias: ${Object.keys(trackAliases).length} canciones, ${Object.keys(artistAliases).length} artistas (duplicados fusionados)`)

const catalogDir = resolve(__dir, '..', 'public', 'catalog')

// ── 2.5. Reutilización del catálogo ya generado (build INCREMENTAL) ───────────
// Por defecto, cada pista/artista que YA está enriquecido en public/catalog se
// reutiliza tal cual y NO se vuelve a pedir a la API: añadir una lista nueva solo
// enriquece lo nuevo (~minutos en vez de ~25 min) y nunca regresiona datos buenos.
// El catálogo versionado actúa así de caché reproducible. `--refresh` reenriquece
// TODO desde cero. Los overrides se aplican igual al final y siguen ganando.
const reuseTrack = new Set(), reuseArtist = new Set()
if (!noLastfm && !refresh) {
  const load = f => { const p = resolve(catalogDir, f); return existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : null }
  const prevT = load('tracks.json'), prevA = load('artists.json')
  if (prevT?.tracks) {
    const byKey = new Map(prevT.tracks.map(t => [t.key, t]))
    const FIELDS = ['album', 'coverUrl', 'durationMs', 'tags', 'listeners', 'lastfmUrl', 'mbid']
    for (const t of tracks) {
      const p = byKey.get(t.key); if (!p) continue
      for (const f of FIELDS) if (p[f] !== undefined && t[f] === undefined) t[f] = p[f]
      reuseTrack.add(t.key)
    }
  }
  if (prevA?.artists) {
    const byKey = new Map(prevA.artists.map(a => [a.key, a]))
    const FIELDS = ['bio', 'imageUrl', 'listeners', 'tags', 'similar', 'mbid', 'topTracks']
    for (const a of artists) {
      const p = byKey.get(a.key); if (!p) continue
      for (const f of FIELDS) if (p[f] !== undefined && a[f] === undefined) a[f] = p[f]
      reuseArtist.add(a.key)
    }
  }
  if (reuseTrack.size || reuseArtist.size)
    console.log(`· reutilizados del catálogo previo: ${reuseTrack.size} tracks, ${reuseArtist.size} artistas (--refresh para re-enriquecer todo)`)
}

// ── 3. Enriquecimiento Last.fm (opcional) ────────────────────────────────────
const primaryName = a => String(a || '').split(', ')[0].trim()
if (!noLastfm) {
  if (!lfm.hasApiKey()) { console.error('Falta VITE_LASTFM_API_KEY (env o ../.env.local). Usa --no-lastfm para saltar.'); process.exit(1) }

  console.log(`\nEnriqueciendo ${tracks.length} tracks vía Last.fm (track.getInfo)…`)
  let n = 0
  for (const t of tracks) {
    if (reuseTrack.has(t.key)) continue   // ya enriquecido en el catálogo previo
    try {
      const data = await lfm.trackGetInfo(primaryName(t.artist), t.title)
      const tr = data?.track
      if (tr) {
        if (!t.album && tr.album?.title) t.album = tr.album.title
        // Carátula: Last.fm manda (la siembra de la DB queda solo de fallback).
        const c = lfm.pickImage(tr.album?.image); if (c) t.coverUrl = c
        const dur = tr.duration ? parseInt(tr.duration, 10) : 0
        if (dur) t.durationMs = dur
        const tags = (tr.toptags?.tag ?? []).slice(0, 5).map(x => x.name).filter(Boolean)
        if (tags.length) t.tags = tags
        const list = tr.listeners ? parseInt(tr.listeners, 10) : 0
        if (list) t.listeners = list
        if (tr.url) t.lastfmUrl = tr.url
        if (tr.mbid) t.mbid = tr.mbid
      }
    } catch (e) { console.warn(`  ! track ${t.key}: ${e.message}`) }
    // Carátula de respaldo (Deezer) si Last.fm no trajo portada o la sembrada
    // está bloqueada por ORB (las de prisaradio no pintan en el navegador).
    if (!t.coverUrl || /prisaradio/i.test(t.coverUrl)) {
      const dz = await deezer.trackCover(primaryName(t.artist), t.title)
      if (dz) t.coverUrl = dz
      else if (/prisaradio/i.test(t.coverUrl || '')) t.coverUrl = undefined  // mejor sin cover que un ORB muerto
    }
    // Duración de respaldo (Deezer) cuando Last.fm no la trajo.
    if (!t.durationMs) {
      const ms = await deezer.trackDuration(primaryName(t.artist), t.title)
      if (ms) t.durationMs = ms
    }
    if (++n % 250 === 0) console.log(`  tracks ${n}/${tracks.length} (api=${lfm.stats.apiCalls} cache=${lfm.stats.cacheHits})`)
  }

  console.log(`\nEnriqueciendo ${artists.length} artistas (artist.getInfo + getTopTracks 50)…`)
  n = 0
  for (const a of artists) {
    if (reuseArtist.has(a.key)) continue   // ya enriquecido en el catálogo previo
    try {
      const info = await lfm.artistGetInfo(a.name)
      const ar = info?.artist
      if (ar) {
        const bio = stripLinks(ar.bio?.summary)
        if (bio) a.bio = bio
        const img = lfm.pickImage(ar.image); if (img) a.imageUrl = img
        const list = ar.stats?.listeners ? parseInt(ar.stats.listeners, 10) : 0
        if (list) a.listeners = list
        const tags = (ar.tags?.tag ?? []).map(x => x.name).filter(Boolean).slice(0, 6)
        if (tags.length) a.tags = tags
        if (ar.mbid) a.mbid = ar.mbid
        // Artistas similares (para recomendaciones offline desde el catálogo).
        const sim = (ar.similar?.artist ?? []).map(x => x.name).filter(Boolean).slice(0, 8)
        if (sim.length) a.similar = sim
      }
      // Pedimos 50 (la API/caché es igual de barata) pero guardamos solo el
      // top-15 en el JSON: el resto la app lo carga bajo demanda ("Mostrar más")
      // y lo cachea en Dexie. Mantiene artists.json ligero.
      const top = await lfm.artistGetTopTracks(a.name, 50)
      const tt = (top?.toptracks?.track ?? []).map(x => ({
        title: x.name,
        ...(x.listeners ? { listeners: parseInt(x.listeners, 10) || undefined } : {})
      })).filter(x => x.title)
      if (tt.length) a.topTracks = tt.slice(0, 15)
      // Foto de artista: Last.fm no la sirve → Deezer.
      if (!a.imageUrl) { const img = await deezer.artistImage(a.name); if (img) a.imageUrl = img }
    } catch (e) { console.warn(`  ! artista ${a.key}: ${e.message}`) }
    if (++n % 100 === 0) console.log(`  artistas ${n}/${artists.length} (lfm=${lfm.stats.apiCalls} dz=${deezer.stats.apiCalls})`)
  }
  lfm.closeCache()
  deezer.closeCache()
  const withPhoto = artists.filter(a => a.imageUrl).length
  console.log(`\n✓ Last.fm: ${lfm.stats.apiCalls} llamadas, ${lfm.stats.cacheHits} de caché`)
  console.log(`✓ Deezer: ${deezer.stats.apiCalls} llamadas (${deezer.stats.misses} sin foto) → ${withPhoto}/${artists.length} artistas con foto`)
}

// ── 3.5. Overrides manuales (chart-pipeline/overrides.json) ──────────────────
// Tus correcciones a mano: se aplican AL FINAL y ganan sobre lo generado, así
// regenerar el catálogo nunca las pierde. Edita ese fichero, no public/catalog/*.
const ovPath = resolve(__dir, 'overrides.json')
if (existsSync(ovPath)) {
  try {
    const n = applyOverrides(tracks, artists, JSON.parse(readFileSync(ovPath, 'utf8')), trackAliases, artistAliases)
    console.log(`· overrides aplicados: ${n}`)
  } catch (e) { console.warn(`! overrides.json inválido, se ignora: ${e.message}`) }
}

// ── 4. Escritura ─────────────────────────────────────────────────────────────
const chartsDir  = resolve(__dir, '..', 'public', 'charts')
mkdirSync(chartsDir,  { recursive: true })
mkdirSync(catalogDir, { recursive: true })

registry.sort((a, b) => a.chartId.localeCompare(b.chartId))
writeFileSync(resolve(chartsDir, 'registry.json'), JSON.stringify(registry))

for (const { chartId, periods } of charts) {
  const compact = compactPeriods(periods, trackIdByKey)
  writeFileSync(resolve(chartsDir, `${chartId}.json`), JSON.stringify({ chartId, periods: compact }))
}
writeFileSync(resolve(catalogDir, 'tracks.json'),  JSON.stringify({ tracks,  aliases: trackAliases }))
writeFileSync(resolve(catalogDir, 'artists.json'), JSON.stringify({ artists, aliases: artistAliases }))

const kb = p => (readFileSync(p).length / 1024).toFixed(0)
console.log('\n✓ Escrito:')
for (const { chartId } of charts) console.log(`  public/charts/${chartId}.json (${kb(resolve(chartsDir, `${chartId}.json`))} KB)`)
console.log(`  public/catalog/tracks.json  (${kb(resolve(catalogDir, 'tracks.json'))} KB)`)
console.log(`  public/catalog/artists.json (${kb(resolve(catalogDir, 'artists.json'))} KB)`)
