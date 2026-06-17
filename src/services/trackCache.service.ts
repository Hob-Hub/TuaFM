import { db, makeCacheKey } from '@/db/local.db'
import { getTrackInfo, isTrustedArtworkUrl, pickImage } from '@/services/lastfm.service'
import { searchVideoCandidates } from '@/services/youtube.service'
import { getDeezerTrackInfo } from '@/services/deezer.service'
import { getTrackByKey } from '@/services/catalog/static.source'
import type { Track } from '@/types/track.types'
import type { LastfmTrackResponse } from '@/types/api.types'
import type { CatalogTrack } from '@/types/chart.types'
import type { LocalTrack } from '@/db/local.db'
import { isExpired, TTL_TRACK_DAYS } from '@/db/cache.helpers'
import { toInt } from '@/utils/number'

/** Resultado de enriquecimiento: nunca lleva `id` para no contaminar el
 *  nanoid de las pistas en las colas al hacer merge (bug C1). */
export type EnrichResult = Omit<Partial<Track>, 'id'>

function stripId(t: Partial<Track>): EnrichResult {
  const { id: _ignored, ...rest } = t
  void _ignored
  if (rest.coverUrl && !isTrustedArtworkUrl(rest.coverUrl)) delete rest.coverUrl
  return rest
}

/**
 * Única puerta de entrada para enriquecer un track.
 * Lookup: Dexie → catálogo estático → APIs externas. Persiste en Dexie.
 *
 * `displayArtist` se usa para las llamadas a Last.fm/YouTube (nombre real con
 * diacríticos), mientras `artist` (normalizado) define el cacheKey. Sin esto,
 * Last.fm recibiría "cafe quijano" en vez de "Café Quijano" y fallaría (bug C2).
 */
export async function resolveTrack(
  artist:           string,
  title:            string,
  existingVideoId?: string,   // precargado desde chart → salta YouTube Data API
  displayArtist?:   string
): Promise<EnrichResult> {
  const cacheKey = makeCacheKey(artist, title)

  // 1 — Dexie local (lookup por PK: id === cacheKey)
  const local = await db.tracks.get(cacheKey)
  if (local && !isExpired(local.localCachedAt, TTL_TRACK_DAYS)) {
    if (existingVideoId && !local.youtubeVideoId) {
      await db.tracks.update(local.id, { youtubeVideoId: existingVideoId })
      return stripId({ ...local, youtubeVideoId: existingVideoId })
    }
    return stripId(local)
  }

  // 2 — Catálogo estático (build): Last.fm ya pre-cacheado en bundle. Evita la
  //      llamada a Last.fm; solo busca YouTube si la pista no trae vídeo (Billboard).
  const catTrack = await getTrackByKey(cacheKey)
  if (catTrack) {
    const enriched = await fromCatalog(catTrack, existingVideoId, displayArtist)
    await persistToLocal(enriched, cacheKey)
    return enriched
  }

  // 3 — Miss total: APIs externas
  const enriched = await fetchExternal(artist, title, existingVideoId, displayArtist)
  await persistToLocal(enriched, cacheKey)
  return enriched
}

// Enriquecimiento desde el catálogo estático: copia los metadatos ya cacheados
// (álbum, tags, duración, oyentes, carátula…) y resuelve YouTube SOLO si falta.
async function fromCatalog(
  cat: CatalogTrack, existingVideoId?: string, displayArtist?: string
): Promise<EnrichResult> {
  const result: EnrichResult = {
    artist:    cat.artist,
    title:     cat.title,
    album:     cat.album,
    year:      cat.year,
    chartYear: cat.chartYear,
    duration:  cat.durationMs,
    language:  cat.language,
    languageConfidence: cat.languageConfidence,
    languageSource: cat.languageSource,
    coverUrl:  isTrustedArtworkUrl(cat.coverUrl) ? cat.coverUrl : undefined,
    tags:      cat.tags ?? [],
    listeners: cat.listeners,
    lastfmUrl: cat.lastfmUrl,
    enriched:  true
  }

  const videoId = existingVideoId ?? cat.youtubeVideoId
  if (videoId) {
    result.youtubeVideoId = videoId
  } else {
    const yt = await searchVideoCandidates(displayArtist ?? cat.artist, cat.title).catch(() => [])
    if (yt.length > 0) {
      result.youtubeVideoId = yt[0]
      if (yt.length > 1) result.youtubeCandidates = yt
    }
  }
  return result
}

async function fetchExternal(
  artist: string, title: string, existingVideoId?: string, displayArtist?: string
): Promise<EnrichResult> {
  const result: EnrichResult = { artist, title, enriched: true }
  const queryArtist = displayArtist ?? artist   // nombre real para APIs externas

  const lfmTask = getTrackInfo(queryArtist, title)
  const ytTask  = existingVideoId
    ? Promise.resolve<string[]>([])
    : searchVideoCandidates(queryArtist, title)

  const [lfm, yt] = await Promise.allSettled([lfmTask, ytTask])

  if (lfm.status === 'fulfilled') {
    const t = (lfm.value as LastfmTrackResponse).track
    result.title     = t.name
    result.artist    = t.artist?.name ?? artist
    result.album     = t.album?.title
    result.duration  = toInt(t.duration)
    result.tags      = t.toptags?.tag.slice(0, 5).map(tag => tag.name) ?? []
    result.listeners = toInt(t.listeners)
    result.lastfmUrl = t.url
    result.coverUrl  = pickImage(t.album?.image)
  } else {
    result.enrichError = true
  }

  if (existingVideoId) {
    result.youtubeVideoId = existingVideoId
  } else if (yt.status === 'fulfilled' && yt.value.length > 0) {
    result.youtubeVideoId    = yt.value[0]
    if (yt.value.length > 1) result.youtubeCandidates = yt.value
  }

  if (!result.coverUrl || lfm.status === 'rejected') {
    const deezer = await getDeezerTrackInfo(queryArtist, title).catch(() => undefined)
    if (deezer) {
      if (lfm.status === 'rejected') {
        result.artist = deezer.artist ?? result.artist
        result.title = deezer.title ?? result.title
        result.album = deezer.album ?? result.album
        result.duration = deezer.durationMs ?? result.duration
      }
      result.coverUrl = result.coverUrl ?? deezer.coverUrl
    }
  }

  return result
}

async function persistToLocal(data: Partial<Track>, cacheKey: string): Promise<void> {
  try {
    const clean = { ...data }
    if (clean.coverUrl && !isTrustedArtworkUrl(clean.coverUrl)) delete clean.coverUrl
    await db.tracks.put({
      ...clean,
      id:            cacheKey,
      title:         clean.title  ?? '',
      artist:        clean.artist ?? '',
      cacheKey,
      enriched:      true,
      localCachedAt: Date.now()
    } as LocalTrack)
  } catch (err) {
    console.warn('[trackCache] Dexie write failed:', err)
  }
}
