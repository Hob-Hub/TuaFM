import type {
  LastfmTrackResponse, LastfmArtistResponse, LastfmSearchResponse,
  LastfmArtistSearchResponse
} from '@/types/api.types'
import { getArtistByKey } from '@/services/catalog/static.source'
import { getDeezerArtistImage, getDeezerTrackCover, isDeezerImageUrl } from '@/services/deezer.service'
import { makeCacheKey, normalizeStr } from '@/utils/normalize'
import { toInt } from '@/utils/number'
import { db } from '@/db/local.db'
import { isExpired, TTL_COVER_DAYS } from '@/db/cache.helpers'

const API_KEY = import.meta.env.VITE_LASTFM_API_KEY
const BASE    = 'https://ws.audioscrobbler.com/2.0/'

interface LastfmErrorBody { error: number; message: string }

/**
 * Llamada base a la API REST de Last.fm. Last.fm responde 200 incluso en
 * errores de dominio, con un body `{ error, message }`. Lo detectamos y
 * lanzamos para que el caller decida (Promise.allSettled lo captura).
 */
export async function lastfmCall<T>(
  method: string,
  params: Record<string, string | number>,
  signal?: AbortSignal
): Promise<T> {
  if (!API_KEY) throw new Error('VITE_LASTFM_API_KEY no configurada')

  const url = new URL(BASE)
  url.searchParams.set('method', method)
  url.searchParams.set('api_key', API_KEY)
  url.searchParams.set('format', 'json')
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v))

  const res = await fetch(url, { signal })
  if (!res.ok) throw new Error(`Last.fm HTTP ${res.status} en ${method}`)

  const data = await res.json() as T & Partial<LastfmErrorBody>
  if (typeof data.error === 'number') {
    throw new Error(`Last.fm error ${data.error}: ${data.message ?? method}`)
  }
  return data as T
}

export function getTrackInfo(
  artist: string, title: string, signal?: AbortSignal
): Promise<LastfmTrackResponse> {
  return lastfmCall<LastfmTrackResponse>('track.getInfo', {
    artist, track: title, autocorrect: 1
  }, signal)
}

export function getArtistInfo(
  artist: string, signal?: AbortSignal
): Promise<LastfmArtistResponse> {
  return lastfmCall<LastfmArtistResponse>('artist.getInfo', {
    artist, autocorrect: 1
  }, signal)
}

export interface TrackSearchResult {
  artist:    string
  title:     string
  listeners: number
  coverUrl?: string
}

/** Búsqueda libre de tracks (para AddTrackModal y el buscador global). */
export async function searchTrack(
  query: string, limit = 20, signal?: AbortSignal
): Promise<TrackSearchResult[]> {
  const data = await lastfmCall<LastfmSearchResponse>('track.search', {
    track: query, limit
  }, signal)
  const matches = data.results?.trackmatches?.track ?? []
  return matches.map(m => ({
    artist:    m.artist,
    title:     m.name,
    listeners: toInt(m.listeners) ?? 0,
    coverUrl:  pickImage(m.image)
  }))
}

export interface ArtistSearchResult {
  name:      string
  listeners: number
  imageUrl?: string
}

/** Búsqueda libre de artistas (para el buscador global). */
export async function searchArtists(
  query: string, limit = 12, signal?: AbortSignal
): Promise<ArtistSearchResult[]> {
  const data = await lastfmCall<LastfmArtistSearchResponse>('artist.search', {
    artist: query, limit
  }, signal)
  const matches = data.results?.artistmatches?.artist ?? []
  return Promise.all(matches.map(async m => {
    const fromLastfm = pickImage(m.image)
    const fromCatalog = (await getArtistByKey(normalizeStr(m.name)))?.imageUrl
    return {
      name:      m.name,
      listeners: toInt(m.listeners) ?? 0,
      imageUrl:  fromLastfm
        ?? (isTrustedArtworkUrl(fromCatalog) ? fromCatalog : undefined)
        ?? await getDeezerArtistImage(m.name, signal)
    }
  }))
}

// Carátula real por canción, SIN tocar YouTube (no gasta cuota): álbum de
// Last.fm exclusivamente. Doble caché: un Map en memoria deduplica peticiones
// en vuelo dentro de la sesión, y Dexie las persiste entre sesiones.
const coverCache = new Map<string, Promise<string | undefined>>()

export function getTrackCover(
  artist: string, title: string, signal?: AbortSignal
): Promise<string | undefined> {
  const key = makeCacheKey(artist, title)
  let p = coverCache.get(key)
  if (!p) {
    p = resolveCoverCached(artist, title, key, signal)
    coverCache.set(key, p)
  }
  return p
}

async function resolveCoverCached(
  artist: string, title: string, key: string, signal?: AbortSignal
): Promise<string | undefined> {
  try {
    const hit = await db.covers.get(key)
    if (hit && !isExpired(hit.localCachedAt, TTL_COVER_DAYS) && isTrustedArtworkUrl(hit.coverUrl)) return hit.coverUrl
  } catch { /* Dexie no disponible → resolvemos por red */ }

  const cover = await resolveTrackCover(artist, title, signal).catch(() => undefined)
  if (cover) {
    try {
      await db.covers.put({ cacheKey: key, coverUrl: cover, localCachedAt: Date.now() })
    } catch { /* persistir es best-effort */ }
  }
  return cover
}

async function resolveTrackCover(
  artist: string, title: string, signal?: AbortSignal
): Promise<string | undefined> {
  try {
    const info  = await getTrackInfo(artist, title, signal)
    const album = info.track.album
    const fromLastfm = pickImage(album?.image)
    if (fromLastfm) return fromLastfm
  } catch {
    /* Deezer fallback below */
  }
  return getDeezerTrackCover(artist, title, signal)
}

// Last.fm restringió las imágenes de artista y devuelve un placeholder "estrella"
// para muchas entidades. Estos hashes identifican ese placeholder; los tratamos
// como "sin imagen" para caer al fallback visual en su lugar.
const LASTFM_PLACEHOLDERS = [
  '2a96cbd8b46e442fc41c2b86b821562f',
  'c6f59c1e5e7240a4c0d427abd71f3dbb'
]

function isPlaceholder(url: string): boolean {
  return LASTFM_PLACEHOLDERS.some(h => url.includes(h))
}

export function isLastfmImageUrl(url?: string): boolean {
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

export function isFimiImageUrl(url?: string): boolean {
  if (!url) return false
  try {
    const host = new URL(url).hostname.toLowerCase()
    return host === 'media.fimi.it' || host === 'www.fimi.it'
  } catch {
    return false
  }
}

const hasImageExtension = (url: string) => /\.(?:jpg|jpeg|png|webp)(?:[?#].*)?$/i.test(url)

export function isPrisaImageUrl(url?: string): boolean {
  if (!url) return false
  try {
    const host = new URL(url).hostname.toLowerCase()
    return host === 'recursosweb.prisaradio.com' && hasImageExtension(url)
  } catch {
    return false
  }
}

export function isSnepImageUrl(url?: string): boolean {
  if (!url) return false
  try {
    const parsed = new URL(url)
    const host = parsed.hostname.toLowerCase()
    return host === 'snepmusique.com'
      && parsed.pathname.includes('/wp-content/uploads/')
      && hasImageExtension(url)
  } catch {
    return false
  }
}

export function isMusicStoryImageUrl(url?: string): boolean {
  if (!url) return false
  try {
    const host = new URL(url).hostname.toLowerCase()
    return host === 'images.music-story.com' && hasImageExtension(url)
  } catch {
    return false
  }
}

export function isTrustedArtworkUrl(url?: string): boolean {
  return isLastfmImageUrl(url)
    || isDeezerImageUrl(url)
    || isFimiImageUrl(url)
    || isPrisaImageUrl(url)
    || isSnepImageUrl(url)
    || isMusicStoryImageUrl(url)
}

/** Selecciona la imagen de mayor tamaño no vacía (ignorando placeholders). */
export function pickImage(images?: Array<{ '#text': string; size: string }>): string | undefined {
  if (!images?.length) return undefined
  const order = ['mega', 'extralarge', 'large', 'medium', 'small']
  for (const size of order) {
    const hit = images.find(i => i.size === size && i['#text'] && !isPlaceholder(i['#text']) && isLastfmImageUrl(i['#text']))
    if (hit) return hit['#text']
  }
  const any = images.find(i => i['#text'] && !isPlaceholder(i['#text']) && isLastfmImageUrl(i['#text']))
  return any?.['#text']
}
