import { doc, getDoc, setDoc } from 'firebase/firestore'
import { getFirestoreDb, ensureAnonymousAuth, isFirebaseConfigured } from '@/firebase/index'
import { db, makeCacheKey } from '@/db/local.db'
import { getTrackInfo, pickImage } from '@/services/lastfm.service'
import { searchVideoCandidates } from '@/services/youtube.service'
import { getCoverUrl } from '@/services/coverart.service'
import { getTrackByKey } from '@/services/catalog/static.source'
import type { Track } from '@/types/track.types'
import type { FirestoreTrackCache, LastfmTrackResponse } from '@/types/api.types'
import type { CatalogTrack } from '@/types/chart.types'
import type { LocalTrack } from '@/db/local.db'

const CACHE_TTL_DAYS = 30

function isExpired(cachedAt: number, ttlDays: number): boolean {
  return Date.now() - cachedAt > ttlDays * 86_400_000
}

/** Convierte un DTO Firestore (con nulls) al dominio Track (con undefined). */
function fromFirestore(fs: FirestoreTrackCache): Partial<Track> {
  return {
    artist:         fs.artist,
    title:          fs.title,
    album:          fs.album          ?? undefined,
    year:           fs.year           ?? undefined,
    duration:       fs.duration       ?? undefined,
    coverUrl:       fs.coverUrl        ?? undefined,
    tags:           fs.tags           ?? [],
    youtubeVideoId: fs.youtubeVideoId ?? undefined,
    youtubeCandidates: fs.youtubeCandidates ?? undefined,
    listeners:      fs.listeners      ?? undefined,
    enriched:       true
  }
}

/** Resultado de enriquecimiento: nunca lleva `id` para no contaminar el
 *  nanoid de las pistas en las colas al hacer merge (bug C1). */
export type EnrichResult = Omit<Partial<Track>, 'id'>

function stripId(t: Partial<Track>): EnrichResult {
  const { id: _ignored, ...rest } = t
  void _ignored
  return rest
}

/**
 * Única puerta de entrada para enriquecer un track.
 * Lookup: Dexie → Firestore → APIs externas. Persiste en ambas cachés.
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
  if (local && !isExpired(local.localCachedAt, CACHE_TTL_DAYS)) {
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
    await persistToFirestore(enriched, cacheKey)
    await persistToLocal(enriched, cacheKey)
    return enriched
  }

  // 3 — Firestore compartido (solo si está configurado)
  if (isFirebaseConfigured) try {
    const fsSnap = await getDoc(doc(getFirestoreDb(), 'track_cache', cacheKey))
    if (fsSnap.exists()) {
      const fsData = fsSnap.data() as FirestoreTrackCache
      if (!isExpired(fsData.cachedAt, fsData.ttlDays)) {
        const merged = fromFirestore(fsData)
        merged.youtubeVideoId = merged.youtubeVideoId ?? existingVideoId
        await persistToLocal(merged, cacheKey)
        return merged
      }
    }
  } catch (err) {
    console.warn('[trackCache] Firestore read failed:', err)
  }

  // 4 — Miss total: APIs externas
  const enriched = await fetchExternal(artist, title, existingVideoId, displayArtist)
  await persistToFirestore(enriched, cacheKey)
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
    duration:  cat.durationMs,
    coverUrl:  cat.coverUrl,
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
    result.duration  = t.duration ? parseInt(t.duration, 10) || undefined : undefined
    result.tags      = t.toptags?.tag.slice(0, 5).map(tag => tag.name) ?? []
    result.listeners = t.listeners ? parseInt(t.listeners, 10) || undefined : undefined
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

  // Fallback de carátula vía MusicBrainz + Cover Art Archive
  if (!result.coverUrl && result.album) {
    const fallback = await getCoverUrl(result.artist!, result.album).catch(() => null)
    if (fallback) result.coverUrl = fallback
  }

  return result
}

async function persistToFirestore(data: Partial<Track>, cacheKey: string): Promise<void> {
  if (!isFirebaseConfigured) return
  try {
    await ensureAnonymousAuth()
    await setDoc(doc(getFirestoreDb(), 'track_cache', cacheKey), {
      cacheKey,
      artist:         data.artist  ?? '',
      title:          data.title   ?? '',
      album:          data.album          ?? null,
      year:           data.year           ?? null,
      duration:       data.duration       ?? null,
      coverUrl:       data.coverUrl       ?? null,
      tags:           data.tags           ?? [],
      youtubeVideoId: data.youtubeVideoId ?? null,
      youtubeCandidates: data.youtubeCandidates ?? [],
      listeners:      data.listeners      ?? null,
      cachedAt:       Date.now(),
      ttlDays:        CACHE_TTL_DAYS
    } satisfies FirestoreTrackCache)
  } catch (err) {
    console.warn('[trackCache] Firestore write failed:', err)
  }
}

async function persistToLocal(data: Partial<Track>, cacheKey: string): Promise<void> {
  try {
    await db.tracks.put({
      ...data,
      id:            cacheKey,
      title:         data.title  ?? '',
      artist:        data.artist ?? '',
      cacheKey,
      enriched:      true,
      localCachedAt: Date.now()
    } as LocalTrack)
  } catch (err) {
    console.warn('[trackCache] Dexie write failed:', err)
  }
}
