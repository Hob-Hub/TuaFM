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
const keepTrustedArtwork = url => lfm.isTrustedArtworkUrl(url) ? url : undefined

function enforceTrustedArtwork(tracks, artists) {
  let droppedCovers = 0
  let droppedArtistImages = 0
  for (const t of tracks) {
    if (t.coverUrl && !lfm.isTrustedArtworkUrl(t.coverUrl)) {
      delete t.coverUrl
      droppedCovers++
    }
  }
  for (const a of artists) {
    if (a.imageUrl && !lfm.isTrustedArtworkUrl(a.imageUrl)) {
      delete a.imageUrl
      droppedArtistImages++
    }
  }
  return { droppedCovers, droppedArtistImages }
}

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
const trackDirectIds = new Map(tracks.map(t => [t.key, t.id]))
const artistDirectIds = new Map(artists.map(a => [a.key, a.id]))
const primaryName = a => String(a || '').split(', ')[0].trim()
const cleanDisplay = value => String(value || '').trim().replace(/\s+/g, ' ')
const lfmArtistName = track => cleanDisplay(typeof track?.artist === 'string' ? track.artist : track?.artist?.name)
const DIACRITICS = /[\u0300-\u036f]/g
const WORD = /(?:[\p{L}\p{N}]\.){2,}[\p{L}\p{N}]?\.?|[\p{L}\p{N}][\p{L}\p{N}'’]*/gu
const SMALL_WORDS = new Set([
  'a', 'an', 'and', 'as', 'at', 'but', 'by', 'for', 'from', 'in', 'into', 'nor', 'of', 'on', 'or', 'the', 'to', 'with',
  'de', 'del', 'da', 'das', 'do', 'dos', 'di', 'du', 'la', 'le', 'les', 'el', 'los', 'las', 'y', 'e', 'et', 'n'
])
const PROTECTED_WORDS = new Set(['dj', 'mc', 'r&b', 'usa', 'uk', 'eu', 'tv', 'fm', 'am', 'pt'])
const stripMarks = s => String(s).normalize('NFD').replace(DIACRITICS, '')
const letters = s => Array.from(String(s || '')).filter(ch => /\p{L}/u.test(ch)).join('')
const hasMarks = s => stripMarks(s) !== String(s)
const fingerprint = s => stripMarks(s).toLowerCase().replace(/[^a-z0-9]+/g, '')
const isAllUpperLetters = s => { const l = letters(s); return l && l === l.toLocaleUpperCase() && l !== l.toLocaleLowerCase() }
const isAllLowerLetters = s => { const l = letters(s); return l && l === l.toLocaleLowerCase() }
const isProtectedUpper = (s, kind = 'track') => {
  const l = letters(s)
  if (kind === 'artist' && l.length <= 5) return true
  return l.length <= 4 || /^(?:[A-Z]\.){2,}$/.test(String(s).trim())
}
const isBrokenCasing = (s, kind = 'track') => {
  const l = letters(s)
  if (l.length < 2) return false
  if (isAllUpperLetters(s) && !isProtectedUpper(s, kind)) return true
  if (isAllLowerLetters(s) && (l.length > 4 || /[\s-]/.test(s)) && !String(s).includes('.')) return true
  return false
}
const wordList = s => [...String(s).matchAll(WORD)].map(m => m[0])
const capitalizedWords = s => wordList(s).filter(w => /^\p{Lu}/u.test(w)).length
const badSmallWordCaps = s => wordList(s).filter((w, i) => i > 0 && SMALL_WORDS.has(stripMarks(w).toLowerCase()) && /^\p{Lu}/u.test(w)).length
const screamingWords = (s, kind = 'track') => wordList(s).filter(w => isAllUpperLetters(w) && letters(w).length > (kind === 'artist' ? 5 : 4)).length
const hasCamelCase = s => /\p{Ll}\p{Lu}/u.test(String(s))
const displayQuality = (s, kind = 'track') => {
  if (!s) return -Infinity
  let score = 0
  if (hasMarks(s)) score += 2
  if (isBrokenCasing(s, kind)) score -= 6
  score += Math.min(4, capitalizedWords(s)) * 0.5
  if (hasCamelCase(s)) score += 1.5
  score -= badSmallWordCaps(s) * 1.5
  score -= screamingWords(s, kind) * 2
  return score
}
const smartWord = (word, index, kind = 'track') => {
  const raw = String(word)
  const lower = raw.toLocaleLowerCase()
  const key = stripMarks(lower)
  if (/^(?:\p{L}\.){2,}\p{L}?\.?$/u.test(raw)) return raw.toLocaleUpperCase()
  if (PROTECTED_WORDS.has(key)) return raw.toLocaleUpperCase()
  if (index > 0 && SMALL_WORDS.has(key)) return lower
  if (/^\d/.test(raw)) {
    if (isAllUpperLetters(raw) && letters(raw).length > 1) {
      return raw.replace(/\p{L}[\p{L}]*/u, segment => {
        const s = segment.toLocaleLowerCase()
        return s.charAt(0).toLocaleUpperCase() + s.slice(1)
      })
    }
    return raw
  }
  if (raw.length <= 1) return raw
  return lower.charAt(0).toLocaleUpperCase() + lower.slice(1)
}
function smartCase(value, kind = 'track') {
  let index = 0
  return cleanDisplay(value).replace(WORD, word => smartWord(word, index++, kind))
}
function chooseDisplay(current, candidate, kind = 'track') {
  const cur = cleanDisplay(current)
  const cand = cleanDisplay(candidate)
  if (!cand) return isBrokenCasing(cur, kind) ? smartCase(cur, kind) : cur
  const normalizedCandidate = isBrokenCasing(cand, kind) ? smartCase(cand, kind) : cand
  if (!cur) return normalizedCandidate
  if (hasMarks(cur) && !hasMarks(cand) && fingerprint(cur) === fingerprint(cand)) {
    return isBrokenCasing(cur, kind) ? smartCase(cur, kind) : cur
  }
  if (isBrokenCasing(cur, kind)) return normalizedCandidate
  if (fingerprint(cur) !== fingerprint(cand)) return cur
  if (displayQuality(normalizedCandidate, kind) > displayQuality(cur, kind)) return normalizedCandidate
  return cur
}

function addArtistAlias(artist, displayName) {
  const key = normalizeStr(displayName)
  if (!key || key === artist.key) return
  const direct = artistDirectIds.get(key)
  if (direct != null && direct !== artist.id) return
  artistAliases[key] = artist.id
}

function applyArtistDisplay(artist, displayName) {
  const name = chooseDisplay(artist?.name, displayName, 'artist')
  if (!artist || !name) return
  addArtistAlias(artist, name)
  artist.name = name
}

function addTrackAlias(track, artistDisplay, titleDisplay) {
  const artistKey = normalizeStr(primaryName(artistDisplay))
  const titleKey = normalizeStr(titleDisplay)
  if (!artistKey || !titleKey) return
  const key = `${artistKey}::${titleKey}`
  if (key === track.key) return
  const direct = trackDirectIds.get(key)
  if (direct != null && direct !== track.id) return
  trackAliases[key] = track.id
}

function applyTrackDisplay(track, data) {
  const tr = data?.track
  if (!tr) return
  const title = chooseDisplay(track.title, tr.name, 'track')
  const artistName = lfmArtistName(tr)
  if (artistName) applyArtistDisplay(artists[track.artistId], artistName)
  if (title) {
    addTrackAlias(track, artistName || artists[track.artistId]?.name || track.artist, title)
    track.title = title
  }
}

function normalizeGeneratedDisplays() {
  for (const artist of artists) applyArtistDisplay(artist, artist.name)
  for (const track of tracks) {
    const title = chooseDisplay(track.title, track.title, 'track')
    if (title) track.title = title
  }
}

function syncTrackArtistDisplays() {
  const artistByKey = new Map(artists.map(a => [a.key, a]))
  for (const track of tracks) {
    const parts = String(track.artist || '').split(',').map(p => p.trim()).filter(Boolean)
    const ids = (track.artistIds?.length ? track.artistIds : [track.artistId])
    const names = parts.map((part, index) => {
      const keyed = artistByKey.get(normalizeStr(part))
      const indexed = artists[ids[index]]
      return chooseDisplay(part, keyed?.name ?? indexed?.name ?? part, 'artist')
    })
    if (!names.length) continue
    track.artist = names.join(', ')
    addTrackAlias(track, names[0], track.title)
  }
}

const tightDisplay = s => stripMarks(String(s)).toLowerCase()
  .replace(/&/g, ' and ')
  .replace(/\$/g, 's')
  .replace(/[^a-z0-9]+/g, '')

const trackDisplayFingerprint = track =>
  `${tightDisplay(primaryName(track.artist))}::${tightDisplay(track.title)}`

const displayPenalty = s => isBrokenCasing(s) ? 4 : 0
const trackScore = track =>
  (track.lastfmUrl ? 8 : 0)
  + (track.mbid ? 5 : 0)
  + (track.coverUrl ? 3 : 0)
  + (track.youtubeVideoId ? 2 : 0)
  + (track.durationMs ? 2 : 0)
  + Math.log10((track.listeners ?? 0) + 1)
  + ((track.artistIds?.length ?? 1) * 1.5)
  - displayPenalty(track.title)
  - displayPenalty(track.artist)

function bestByScore(items, score) {
  return [...items].sort((a, b) => score(b) - score(a) || a.id - b.id)[0]
}

function titleScore(track) {
  return displayQuality(track.title, 'track')
    + (track.lastfmUrl ? 2 : 0)
    + (track.mbid ? 1 : 0)
    + Math.log10((track.listeners ?? 0) + 1) * 0.25
}

function artistDisplayScore(track) {
  return displayQuality(track.artist, 'artist')
    + ((track.artistIds?.length ?? 1) * 2)
    + (isBrokenCasing(track.artist, 'artist') ? -4 : 0)
}

function mergeTrackGroup(group) {
  const base = { ...bestByScore(group, trackScore) }
  const titleSource = bestByScore(group, titleScore)
  const artistSource = bestByScore(group, artistDisplayScore)
  const oldIds = group.map(t => t.id)
  const oldKeys = group.map(t => t.key)
  const artistIds = []
  for (const id of (artistSource.artistIds?.length ? artistSource.artistIds : [artistSource.artistId])) {
    if (!artistIds.includes(id)) artistIds.push(id)
  }
  for (const track of group) {
    for (const id of (track.artistIds?.length ? track.artistIds : [track.artistId])) {
      if (!artistIds.includes(id)) artistIds.push(id)
    }
  }
  const primaryKey = normalizeStr(primaryName(artistSource.artist))
  const primaryId = artists.find(a => a.key === primaryKey)?.id ?? artistSource.artistId ?? artistIds[0]

  base.title = titleSource.title
  base.artist = artistSource.artist
  base.artistId = primaryId
  base.artistIds = artistIds
  base.chartYear = Math.min(...group.map(t => t.chartYear ?? Infinity).filter(Number.isFinite))
  if (!Number.isFinite(base.chartYear)) delete base.chartYear

  const fields = ['album', 'year', 'youtubeVideoId', 'durationMs', 'lastfmUrl', 'mbid', 'coverUrl']
  for (const field of fields) {
    const source = bestByScore(group.filter(t => t[field] != null), trackScore)
    if (source?.[field] != null) base[field] = source[field]
  }
  const listeners = Math.max(...group.map(t => t.listeners ?? 0))
  if (listeners) base.listeners = listeners
  const tags = []
  for (const track of group) {
    for (const tag of track.tags ?? []) if (!tags.includes(tag)) tags.push(tag)
  }
  if (tags.length) base.tags = tags.slice(0, 8)

  return { track: base, oldIds, oldKeys, order: Math.min(...oldIds) }
}

function dedupeTracksByDisplay() {
  const groups = new Map()
  for (const track of tracks) {
    const fp = trackDisplayFingerprint(track)
    if (!groups.has(fp)) groups.set(fp, [])
    groups.get(fp).push(track)
  }

  const merged = []
  for (const group of groups.values()) {
    merged.push(group.length === 1
      ? { track: { ...group[0] }, oldIds: [group[0].id], oldKeys: [group[0].key], order: group[0].id }
      : mergeTrackGroup(group))
  }
  merged.sort((a, b) => a.order - b.order)

  const oldToNew = new Map()
  const directKeys = new Set()
  tracks.length = 0
  for (const item of merged) {
    item.track.id = tracks.length
    tracks.push(item.track)
    directKeys.add(item.track.key)
    for (const oldId of item.oldIds) oldToNew.set(oldId, item.track.id)
  }

  for (const [key, id] of [...trackIdByKey.entries()]) {
    trackIdByKey.set(key, oldToNew.get(id) ?? id)
  }

  const nextAliases = {}
  for (const [key, id] of Object.entries(trackAliases)) {
    const mapped = oldToNew.get(id) ?? id
    if (!directKeys.has(key)) nextAliases[key] = mapped
  }
  for (const item of merged) {
    for (const oldKey of item.oldKeys) {
      trackIdByKey.set(oldKey, item.track.id)
      if (oldKey !== item.track.key && !directKeys.has(oldKey)) nextAliases[oldKey] = item.track.id
    }
  }
  for (const key of Object.keys(trackAliases)) delete trackAliases[key]
  Object.assign(trackAliases, nextAliases)

  return [...oldToNew.entries()].filter(([oldId, newId]) => oldId !== newId).length
}

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
      for (const f of FIELDS) {
        if (p[f] === undefined || t[f] !== undefined) continue
        t[f] = f === 'coverUrl' ? keepTrustedArtwork(p[f]) : p[f]
      }
      const cached = lfm.peekTrackGetInfo(primaryName(t.artist), t.title)
      if (cached?.track) applyTrackDisplay(t, cached)
      else if (p.title) t.title = p.title
      reuseTrack.add(t.key)
    }
  }
  if (prevA?.artists) {
    const byKey = new Map(prevA.artists.map(a => [a.key, a]))
    const FIELDS = ['bio', 'imageUrl', 'listeners', 'tags', 'similar', 'mbid', 'topTracks']
    for (const a of artists) {
      const p = byKey.get(a.key); if (!p) continue
      for (const f of FIELDS) {
        if (p[f] === undefined || a[f] !== undefined) continue
        a[f] = f === 'imageUrl' ? keepTrustedArtwork(p[f]) : p[f]
      }
      const cached = lfm.peekArtistGetInfo(a.name)
      if (cached?.artist?.name) applyArtistDisplay(a, cached.artist.name)
      else if (p.name) applyArtistDisplay(a, p.name)
      reuseArtist.add(a.key)
    }
  }
  if (reuseTrack.size || reuseArtist.size)
    console.log(`· reutilizados del catálogo previo: ${reuseTrack.size} tracks, ${reuseArtist.size} artistas (--refresh para re-enriquecer todo)`)
}

// ── 3. Enriquecimiento Last.fm (opcional) ────────────────────────────────────
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
        applyTrackDisplay(t, data)
        if (!t.album && tr.album?.title) t.album = tr.album.title
        // Carátula: Last.fm primero; Deezer solo como fallback.
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
    if (!t.coverUrl) {
      const dz = await deezer.trackCover(primaryName(t.artist), t.title)
      if (dz) t.coverUrl = dz
    }
    if (t.coverUrl && !lfm.isTrustedArtworkUrl(t.coverUrl)) delete t.coverUrl
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
      const queryName = a.name
      const info = await lfm.artistGetInfo(queryName)
      const ar = info?.artist
      if (ar) {
        applyArtistDisplay(a, ar.name)
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
      const top = await lfm.artistGetTopTracks(queryName, 50)
      const tt = (top?.toptracks?.track ?? []).map(x => ({
        title: x.name,
        ...(x.listeners ? { listeners: parseInt(x.listeners, 10) || undefined } : {})
      })).filter(x => x.title)
      if (tt.length) a.topTracks = tt.slice(0, 15)
    } catch (e) { console.warn(`  ! artista ${a.key}: ${e.message}`) }
    if (!a.imageUrl) {
      const img = await deezer.artistImage(a.name)
      if (img) a.imageUrl = img
    }
    if (a.imageUrl && !lfm.isTrustedArtworkUrl(a.imageUrl)) delete a.imageUrl
    if (++n % 100 === 0) console.log(`  artistas ${n}/${artists.length} (lfm=${lfm.stats.apiCalls} dz=${deezer.stats.apiCalls})`)
  }
  lfm.closeCache()
  deezer.closeCache()
  const withPhoto = artists.filter(a => a.imageUrl).length
  console.log(`\n✓ Last.fm: ${lfm.stats.apiCalls} llamadas, ${lfm.stats.cacheHits} de caché`)
  console.log(`✓ Deezer: ${deezer.stats.apiCalls} llamadas, ${deezer.stats.cacheHits} de caché`)
  console.log(`✓ Artwork Last.fm/Deezer: ${tracks.filter(t => t.coverUrl).length}/${tracks.length} carátulas, ${withPhoto}/${artists.length} artistas`)
}

normalizeGeneratedDisplays()
syncTrackArtistDisplays()
const mergedTrackAliases = dedupeTracksByDisplay()
console.log(`· tracks fusionados por nombre normalizado: ${mergedTrackAliases}`)
console.log(`· alias finales: ${Object.keys(trackAliases).length} canciones, ${Object.keys(artistAliases).length} artistas`)

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

const sanitized = enforceTrustedArtwork(tracks, artists)
if (sanitized.droppedCovers || sanitized.droppedArtistImages) {
  console.log(`· artwork no Last.fm/Deezer descartado: ${sanitized.droppedCovers} carátulas, ${sanitized.droppedArtistImages} artistas`)
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
