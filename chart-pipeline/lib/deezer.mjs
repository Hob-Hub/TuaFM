// Datos desde la API pública de Deezer (sin clave), EN BUILD: artwork como
// fallback tras Last.fm y duración de pista como respaldo cuando Last.fm no la trae.
//
// Throttle suave + caché de reanudación en .deezer-cache.db (gitignored).

import { DatabaseSync } from 'node:sqlite'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dir = dirname(fileURLToPath(import.meta.url))
const cacheDb = new DatabaseSync(resolve(__dir, '..', '.deezer-cache.db'))
cacheDb.exec('CREATE TABLE IF NOT EXISTS cache (k TEXT PRIMARY KEY, json TEXT, fetched_at INTEGER)')
const sel = cacheDb.prepare('SELECT json FROM cache WHERE k = ?')
const ins = cacheDb.prepare('INSERT OR REPLACE INTO cache (k, json, fetched_at) VALUES (?, ?, ?)')

const MIN_INTERVAL_MS = 120
let lastAt = 0
const sleep = ms => new Promise(r => setTimeout(r, ms))
const norm = s => String(s).toLowerCase().trim()
const stripMarks = s => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
const tight = s => stripMarks(s).toLowerCase()
  .replace(/f\*+\s*k/g, 'fuck')
  .replace(/s\*+\s*t/g, 'shit')
  .replace(/p\*+\$\$y/g, 'pussy')
  .replace(/&/g, ' and ')
  .replace(/\$/g, 's')
  .replace(/!/g, 'i')
  .replace(/\/x\b/g, 'ix')
  .replace(/\bpt\b/g, 'part')
  .replace(/[^a-z0-9]+/g, '')
const primary = s => String(s || '').split(',')[0].trim()
const titleBase = s => tight(String(s || '').replace(/\s*[\[(].*?[\])]\s*/g, ' '))

function compatibleText(query, result) {
  const q = tight(query)
  const r = tight(result)
  if (!q || !r) return false
  return q === r || (q.length >= 8 && r.includes(q)) || (r.length >= 8 && q.includes(r))
}

function compatibleArtist(query, result) {
  if (compatibleText(query, result)) return true
  const q = tight(query)
  const r = tight(result)
  return q.length >= 5 && r.length >= 5 && (q.includes(r) || r.includes(q))
}

function compatibleTitle(query, result) {
  if (compatibleText(query, result)) return true
  const q = titleBase(query)
  const r = tight(result)
  return q.length >= 4 && r.includes(q)
}

function isCompatibleTrack(queryArtist, queryTitle, track) {
  return compatibleArtist(primary(queryArtist), track?.artist?.name)
    && compatibleTitle(queryTitle, track?.title_short || track?.title)
}

function extractTrackInfo(artist, title) {
  return d => {
    const tr = d?.data?.find(item => isCompatibleTrack(artist, title, item))
    if (!tr) return null
    const al = tr.album
    return {
      id: tr.id ?? null,
      title: tr.title_short || tr.title || null,
      artist: tr.artist?.name || null,
      album: al?.title || null,
      link: tr.link || null,
      cover: al?.cover_xl || al?.cover_big || al?.cover_medium || null,
      durationMs: tr.duration ? Number(tr.duration) * 1000 : null
    }
  }
}

export const stats = { apiCalls: 0, cacheHits: 0, misses: 0 }

/**
 * GET a Deezer con throttle y caché de reanudación. `extract(body)` saca el valor
 * del cuerpo JSON. Cachea también el "sin resultado" (null) para no repetirlo; un
 * fallo de RED no se cachea, se reintenta en la siguiente pasada.
 */
async function cachedGet(key, url, extract) {
  const cached = sel.get(key)
  if (cached) { stats.cacheHits++; return JSON.parse(cached.json) }

  const wait = MIN_INTERVAL_MS - (Date.now() - lastAt)
  if (wait > 0) await sleep(wait)
  lastAt = Date.now()
  stats.apiCalls++

  let value
  try {
    const res = await fetch(url)
    value = res.ok ? extract(await res.json()) : null
  } catch {
    return null   // red caída: no cachear → se reintenta en el siguiente pase
  }
  if (value == null) stats.misses++
  ins.run(key, JSON.stringify(value ?? null), Date.now())
  return value ?? null
}

/** Mejor URL de imagen del artista, o null si no hay coincidencia. */
export function artistImage(name) {
  return cachedGet(
    `artist:${norm(name)}`,
    `https://api.deezer.com/search/artist?limit=1&q=${encodeURIComponent(name)}`,
    d => {
      const a = d?.data?.[0]
      return a?.picture_xl || a?.picture_big || a?.picture_medium || null
    }
  )
}

export function trackInfo(artist, title) {
  const q = `artist:"${artist}" track:"${title}"`
  return cachedGet(
    `trk3:${norm(artist)}::${norm(title)}`,
    `https://api.deezer.com/search?limit=1&q=${encodeURIComponent(q)}`,
    extractTrackInfo(artist, title)
  ).then(hit => hit ?? cachedGet(
    `trk3flex:${norm(artist)}::${norm(title)}`,
    `https://api.deezer.com/search?limit=5&q=${encodeURIComponent(`${artist} ${title}`)}`,
    extractTrackInfo(artist, title)
  ))
}

export async function trackCover(artist, title) { return (await trackInfo(artist, title))?.cover ?? null }
export async function trackDuration(artist, title) { return (await trackInfo(artist, title))?.durationMs ?? null }

export function closeCache() { cacheDb.close() }
