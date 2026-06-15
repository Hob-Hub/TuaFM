// Cliente Last.fm para el build del catálogo (Node ≥ 22). Con throttle suave
// (~5 req/s, lo que pide Last.fm) y CACHÉ DE REANUDACIÓN en SQLite local: cada
// respuesta (incluido "no encontrado") se guarda por method+args, así un segundo
// pase no vuelve a pegar a la API. La caché (.lastfm-cache.db) está en .gitignore.

import { DatabaseSync } from 'node:sqlite'
import { readFileSync, existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dir = dirname(fileURLToPath(import.meta.url))
const BASE  = 'https://ws.audioscrobbler.com/2.0/'

// ── Clave de API: env del proceso o ../../.env.local ─────────────────────────
function readApiKey() {
  if (process.env.VITE_LASTFM_API_KEY) return process.env.VITE_LASTFM_API_KEY
  const envPath = resolve(__dir, '..', '..', '.env.local')
  if (existsSync(envPath)) {
    const m = readFileSync(envPath, 'utf8').match(/^\s*VITE_LASTFM_API_KEY\s*=\s*(.+)\s*$/m)
    if (m) return m[1].trim().replace(/^["']|["']$/g, '')
  }
  return null
}

// ── Caché SQLite ─────────────────────────────────────────────────────────────
const cacheDb = new DatabaseSync(resolve(__dir, '..', '.lastfm-cache.db'))
cacheDb.exec(`CREATE TABLE IF NOT EXISTS cache (
  k TEXT PRIMARY KEY, json TEXT, fetched_at INTEGER
)`)
const selStmt = cacheDb.prepare('SELECT json FROM cache WHERE k = ?')
const insStmt = cacheDb.prepare('INSERT OR REPLACE INTO cache (k, json, fetched_at) VALUES (?, ?, ?)')

// ── Throttle ─────────────────────────────────────────────────────────────────
const MIN_INTERVAL_MS = 210
let lastCallAt = 0
const sleep = ms => new Promise(r => setTimeout(r, ms))
async function throttle() {
  const wait = MIN_INTERVAL_MS - (Date.now() - lastCallAt)
  if (wait > 0) await sleep(wait)
  lastCallAt = Date.now()
}

export const stats = { apiCalls: 0, cacheHits: 0, errors: 0 }

let API_KEY = null
export function hasApiKey() {
  if (API_KEY === null) API_KEY = readApiKey() || ''
  return Boolean(API_KEY)
}

// Llamada base con caché. Devuelve el objeto JSON, o null si Last.fm responde un
// error de dominio (p. ej. artista/canción no encontrados). Lanza solo en fallos
// de red/HTTP (no se cachean → se reintentan en el siguiente pase).
async function call(method, params) {
  const entries = Object.entries(params).filter(([, v]) => v !== undefined && v !== '')
  entries.sort(([a], [b]) => a.localeCompare(b))
  const k = `${method}?${entries.map(([key, v]) => `${key}=${v}`).join('&')}`.toLowerCase()

  const cached = selStmt.get(k)
  if (cached) { stats.cacheHits++; return JSON.parse(cached.json) }

  if (!hasApiKey()) throw new Error('VITE_LASTFM_API_KEY no configurada (env o ../../.env.local)')

  const url = new URL(BASE)
  url.searchParams.set('method', method)
  url.searchParams.set('api_key', API_KEY)
  url.searchParams.set('format', 'json')
  for (const [key, v] of entries) url.searchParams.set(key, String(v))

  await throttle()
  stats.apiCalls++
  const res = await fetch(url)
  if (!res.ok) {
    if (res.status === 429) { await sleep(2000) }   // rate limited: respira
    throw new Error(`Last.fm HTTP ${res.status} en ${method}`)
  }
  const data = await res.json()
  const value = typeof data.error === 'number' ? null : data   // error dominio → null
  if (typeof data.error === 'number') stats.errors++
  insStmt.run(k, JSON.stringify(value), Date.now())
  return value
}

// ── Selección de imagen (idéntica a src/services/lastfm.service.ts) ──────────
const LASTFM_PLACEHOLDERS = [
  '2a96cbd8b46e442fc41c2b86b821562f',
  'c6f59c1e5e7240a4c0d427abd71f3dbb'
]
const isPlaceholder = u => LASTFM_PLACEHOLDERS.some(h => u.includes(h))

export function isLastfmImageUrl(url) {
  if (!url) return false
  try {
    const host = new URL(url).hostname.toLowerCase()
    return host === 'lastfm.freetls.fastly.net'
      || host === 'lastfm-img2.akamaized.net'
      || host.endsWith('.last.fm')
  } catch {
    return false
  }
}

export function isDeezerImageUrl(url) {
  if (!url) return false
  try {
    const host = new URL(url).hostname.toLowerCase()
    return host === 'cdn-images.dzcdn.net' || host.endsWith('.dzcdn.net')
  } catch {
    return false
  }
}

export function isTrustedArtworkUrl(url) {
  return isLastfmImageUrl(url) || isDeezerImageUrl(url)
}

export function pickImage(images) {
  if (!images?.length) return undefined
  for (const size of ['mega', 'extralarge', 'large', 'medium', 'small']) {
    const hit = images.find(i => i.size === size && i['#text'] && !isPlaceholder(i['#text']) && isLastfmImageUrl(i['#text']))
    if (hit) return hit['#text']
  }
  const any = images.find(i => i['#text'] && !isPlaceholder(i['#text']) && isLastfmImageUrl(i['#text']))
  return any?.['#text']
}

// ── Métodos usados por el builder ────────────────────────────────────────────
export function trackGetInfo(artist, title) {
  return call('track.getInfo', { artist, track: title, autocorrect: 1 })
}
export function artistGetInfo(artist) {
  return call('artist.getInfo', { artist, autocorrect: 1 })
}
export function artistGetTopTracks(artist, limit = 50) {
  return call('artist.getTopTracks', { artist, limit, autocorrect: 1 })
}

export function closeCache() { cacheDb.close() }
