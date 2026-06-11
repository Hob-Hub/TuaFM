// Imágenes de artista desde la API pública de Deezer (sin clave). Last.fm dejó de
// servir fotos de artista (devuelve un placeholder), así que para la ficha de
// artista las tomamos de Deezer EN BUILD (en Node no hay CORS; la URL resultante
// se muestra como <img> en el navegador sin problema).
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

export const stats = { apiCalls: 0, cacheHits: 0, misses: 0 }

/** Devuelve la mejor URL de imagen del artista, o null si no hay coincidencia. */
export async function artistImage(name) {
  const k = `artist:${String(name).toLowerCase().trim()}`
  const cached = sel.get(k)
  if (cached) { stats.cacheHits++; return JSON.parse(cached.json) }

  const url = `https://api.deezer.com/search/artist?limit=1&q=${encodeURIComponent(name)}`
  const wait = MIN_INTERVAL_MS - (Date.now() - lastAt)
  if (wait > 0) await sleep(wait)
  lastAt = Date.now()
  stats.apiCalls++

  let image = null
  try {
    const res = await fetch(url)
    if (res.ok) {
      const data = await res.json()
      const a = data?.data?.[0]
      image = a?.picture_xl || a?.picture_big || a?.picture_medium || null
    }
  } catch { /* red: no cachear, se reintenta en el siguiente pase */ }

  if (image) { ins.run(k, JSON.stringify(image), Date.now()) }
  else { stats.misses++; ins.run(k, JSON.stringify(null), Date.now()) }   // cachear "sin foto"
  return image
}

/**
 * Carátula de álbum para un (artista,título) desde Deezer. Respaldo cuando
 * Last.fm no trae portada o la sembrada está bloqueada por ORB (prisaradio).
 * Las URLs de Deezer son CORS-friendly → se pintan sin problema en el navegador.
 */
export async function trackCover(artist, title) {
  const k = `track:${String(artist).toLowerCase().trim()}::${String(title).toLowerCase().trim()}`
  const cached = sel.get(k)
  if (cached) { stats.cacheHits++; return JSON.parse(cached.json) }

  const q = `artist:"${artist}" track:"${title}"`
  const url = `https://api.deezer.com/search?limit=1&q=${encodeURIComponent(q)}`
  const wait = MIN_INTERVAL_MS - (Date.now() - lastAt)
  if (wait > 0) await sleep(wait)
  lastAt = Date.now()
  stats.apiCalls++

  let cover = null
  try {
    const res = await fetch(url)
    if (res.ok) {
      const data = await res.json()
      const al = data?.data?.[0]?.album
      cover = al?.cover_xl || al?.cover_big || al?.cover_medium || null
    }
  } catch { /* red: no cachear, se reintenta en el siguiente pase */ }

  if (cover) { ins.run(k, JSON.stringify(cover), Date.now()) }
  else { stats.misses++; ins.run(k, JSON.stringify(null), Date.now()) }
  return cover
}

export function closeCache() { cacheDb.close() }
