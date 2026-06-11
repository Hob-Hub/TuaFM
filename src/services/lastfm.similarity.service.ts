import { lastfmCall } from '@/services/lastfm.service'
import { db } from '@/db/local.db'
import { isExpired, makeLastfmCacheKey, TTL_SIMILARITY_DAYS } from '@/db/cache.helpers'
import type {
  LastfmSimilarTracksResponse, LastfmSimilarArtistsResponse,
  LastfmArtistTopTracksResponse, LastfmTrackTopTagsResponse,
  LastfmTagTopTracksResponse
} from '@/types/api.types'

/**
 * Envuelve una llamada a Last.fm con caché persistente en Dexie. El grafo de
 * similitud (mismo método + mismos args) es estable, así que se reusa entre
 * sesiones y evita re-pegar a la API en cada "Generar recomendaciones". Solo se
 * cachean respuestas correctas; si la llamada falla, se propaga sin cachear.
 */
async function cached<T>(
  method: string,
  params: Record<string, string | number>,
  fn: () => Promise<T>
): Promise<T> {
  const key = makeLastfmCacheKey(method, params)
  try {
    const hit = await db.lastfmCache.get(key)
    if (hit && !isExpired(hit.localCachedAt, TTL_SIMILARITY_DAYS)) return hit.json as T
  } catch { /* Dexie no disponible → seguimos a la red */ }

  const res = await fn()
  try {
    await db.lastfmCache.put({ key, json: res, localCachedAt: Date.now() })
  } catch { /* persistir es best-effort */ }
  return res
}

export function getSimilarTracks(
  artist: string, title: string, limit = 15
): Promise<LastfmSimilarTracksResponse> {
  return cached('track.getSimilar', { artist, track: title, limit }, () =>
    lastfmCall<LastfmSimilarTracksResponse>('track.getSimilar', {
      artist, track: title, limit, autocorrect: 1
    }))
}

export function getSimilarArtists(
  artist: string, limit = 4
): Promise<LastfmSimilarArtistsResponse> {
  return cached('artist.getSimilar', { artist, limit }, () =>
    lastfmCall<LastfmSimilarArtistsResponse>('artist.getSimilar', {
      artist, limit, autocorrect: 1
    }))
}

export function getArtistTopTracks(
  artist: string, limit = 4
): Promise<LastfmArtistTopTracksResponse> {
  return cached('artist.getTopTracks', { artist, limit }, () =>
    lastfmCall<LastfmArtistTopTracksResponse>('artist.getTopTracks', {
      artist, limit, autocorrect: 1
    }))
}

export function getTrackTopTags(
  artist: string, title: string
): Promise<LastfmTrackTopTagsResponse> {
  return cached('track.getTopTags', { artist, track: title }, () =>
    lastfmCall<LastfmTrackTopTagsResponse>('track.getTopTags', {
      artist, track: title, autocorrect: 1
    }))
}

export function getTagTopTracks(
  tag: string, limit = 10
): Promise<LastfmTagTopTracksResponse> {
  return cached('tag.getTopTracks', { tag, limit }, () =>
    lastfmCall<LastfmTagTopTracksResponse>('tag.getTopTracks', { tag, limit }))
}
