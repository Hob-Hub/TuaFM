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

function dzTrackInfo(artist, title) {
  const q = `artist:"${artist}" track:"${title}"`
  return cachedGet(
    `trk:${norm(artist)}::${norm(title)}`,
    `https://api.deezer.com/search?limit=1&q=${encodeURIComponent(q)}`,
    d => {
      const tr = d?.data?.[0]
      if (!tr) return null
      const al = tr.album
      return {
        cover: al?.cover_xl || al?.cover_big || al?.cover_medium || null,
        durationMs: tr.duration ? Number(tr.duration) * 1000 : null
      }
    }
  )
}

export async function trackCover(artist, title) { return (await dzTrackInfo(artist, title))?.cover ?? null }
export async function trackDuration(artist, title) { return (await dzTrackInfo(artist, title))?.durationMs ?? null }

export function closeCache() { cacheDb.close() }
