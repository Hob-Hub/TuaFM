import { ref } from 'vue'
import { getArtistInfo, isTrustedArtworkUrl, pickImage, getTrackCover } from '@/services/lastfm.service'
import { getDeezerArtistImage } from '@/services/deezer.service'
import { getArtistTopTracks, getSimilarArtists } from '@/services/lastfm.similarity.service'
import { getArtistByKey, getTrackByKey } from '@/services/catalog/static.source'
import { normalizeStr, makeCacheKey } from '@/utils/normalize'
import { toInt } from '@/utils/number'
import { db } from '@/db/local.db'
import { isExpired, TTL_ARTIST_DAYS } from '@/db/cache.helpers'
import type { LocalArtist } from '@/db/local.db'

const INITIAL_TOP = 15   // se muestra de entrada
const FULL_TOP    = 50   // tras "Mostrar más"

export interface ArtistTopTrack {
  title:     string
  listeners: number
  coverUrl?: string
}

export interface ArtistInfo {
  name:              string
  bio:               string
  listeners:         number
  imageUrl?:         string
  tags:              string[]
  topTracks:         ArtistTopTrack[]
  topTracksComplete: boolean   // ¿ya tenemos el top-50 (no solo el top-15)?
  similar:           string[]  // nombres de artistas similares (catálogo o Last.fm)
}

const SIMILAR_LIMIT = 8

export function useArtist() {
  const info       = ref<ArtistInfo | null>(null)
  const loading    = ref(false)
  const loadingMore = ref(false)
  const error      = ref<string | null>(null)

  async function load(artist: string): Promise<void> {
    loading.value = true
    error.value   = null
    info.value    = null
    const key = normalizeStr(artist)
    try {
      // 1 — Catálogo estático (build): ficha pre-cacheada → sin pegar a Last.fm.
      //     Trae el top inicial; la lista ampliada se pide en loadMore().
      const cat = await getArtistByKey(key)
      if (cat) {
        info.value = {
          name:              cat.name,
          bio:               cat.bio ?? '',
          listeners:         cat.listeners ?? 0,
          imageUrl:          isTrustedArtworkUrl(cat.imageUrl) ? cat.imageUrl : undefined,
          tags:              cat.tags ?? [],
          topTracks:         (cat.topTracks ?? []).slice(0, INITIAL_TOP)
                               .map(t => ({ title: t.title, listeners: t.listeners ?? 0 })),
          topTracksComplete: false,
          similar:           (cat.similar ?? []).slice(0, SIMILAR_LIMIT)
        }
        void resolveCovers(cat.name, info.value.topTracks)
        if (!info.value.similar.length) void fillSimilar(cat.name)
        return
      }

      // 2 — Dexie (artistas no-catálogo ya resueltos): reusa entre sesiones.
      const cached = await readArtistCache(key)
      if (cached) {
        info.value = cached
        void resolveCovers(cached.name, info.value.topTracks)
        void fillSimilar(cached.name)   // similar no se persiste; getSimilarArtists ya cachea
        return
      }

      // 3 — Last.fm. Pedimos el top-50 de una vez (mismo coste que pedir 15) y
      //     guardamos completo; la UI muestra 15 y revela el resto sin más red.
      const [infoRes, topRes, simRes] = await Promise.allSettled([
        getArtistInfo(artist),
        getArtistTopTracks(artist, FULL_TOP),
        getSimilarArtists(artist, SIMILAR_LIMIT)
      ])
      if (infoRes.status !== 'fulfilled') {
        throw new Error('No se encontró información del artista')
      }
      const a = infoRes.value.artist
      const top: ArtistTopTrack[] = topRes.status === 'fulfilled'
        ? topRes.value.toptracks.track.map(t => ({ title: t.name, listeners: toInt(t.listeners) ?? 0 }))
        : []
      const similar: string[] = simRes.status === 'fulfilled'
        ? simRes.value.similarartists.artist.map(s => s.name).filter(Boolean)
        : []

      info.value = {
        name:              a.name,
        bio:               stripLinks(a.bio?.summary ?? ''),
        listeners:         toInt(a.stats?.listeners) ?? 0,
        imageUrl:          pickImage(a.image) ?? await getDeezerArtistImage(a.name).catch(() => undefined),
        tags:              (a.tags?.tag ?? []).map(t => t.name).slice(0, 6),
        topTracks:         top,
        topTracksComplete: topRes.status === 'fulfilled',
        similar
      }
      await persistArtistCache(key, info.value)
      void resolveCovers(a.name, info.value.topTracks)
    } catch (e) {
      error.value = (e as Error).message
    } finally {
      loading.value = false
    }
  }

  /**
   * "Mostrar más": completa el top hasta 50. Si ya está completo (no-catálogo o
   * tras una primera ampliación) no hace red. Para artistas de catálogo, pide a
   * Last.fm una vez y lo persiste en Dexie → la próxima visita ya no llama.
   */
  async function loadMore(): Promise<void> {
    if (!info.value || info.value.topTracksComplete || loadingMore.value) return
    loadingMore.value = true
    try {
      const res = await getArtistTopTracks(info.value.name, FULL_TOP)
      const full: ArtistTopTrack[] = res.toptracks.track.map(
        t => ({ title: t.name, listeners: toInt(t.listeners) ?? 0 })
      )
      // Conserva las carátulas ya resueltas de las primeras filas.
      const coverByTitle = new Map(info.value.topTracks.map(t => [t.title, t.coverUrl]))
      for (const t of full) t.coverUrl = t.coverUrl ?? coverByTitle.get(t.title)

      info.value.topTracks         = full.length ? full : info.value.topTracks
      info.value.topTracksComplete = true
      await persistArtistCache(normalizeStr(info.value.name), info.value)
      void resolveCovers(info.value.name, info.value.topTracks)
    } catch {
      // Si falla, dejamos lo que había; el botón puede reintentarse.
    } finally {
      loadingMore.value = false
    }
  }

  // Rellena los similares desde Last.fm (cacheado) cuando el catálogo no los trae
  // o el artista viene de Dexie. Best-effort: no bloquea ni rompe la ficha.
  async function fillSimilar(name: string): Promise<void> {
    try {
      const res = await getSimilarArtists(name, SIMILAR_LIMIT)
      const names = res.similarartists.artist.map(s => s.name).filter(Boolean)
      if (names.length && info.value && info.value.name === name) info.value.similar = names
    } catch {
      /* best-effort */
    }
  }

  // Resuelve carátulas con concurrencia limitada para no saturar Last.fm. Cada
  // una persiste en Dexie (getTrackCover) → en visitas siguientes no se re-piden.
  async function resolveCovers(artistName: string, tracks: ArtistTopTrack[]): Promise<void> {
    const CONCURRENCY = 5
    let i = 0
    async function worker(): Promise<void> {
      while (i < tracks.length) {
        const track = tracks[i++]
        if (track.coverUrl) continue
        const fromCat = await getTrackByKey(makeCacheKey(artistName, track.title))
        const fromCatalog = isTrustedArtworkUrl(fromCat?.coverUrl) ? fromCat?.coverUrl : undefined
        const cover = fromCatalog ?? await getTrackCover(artistName, track.title).catch(() => undefined)
        if (cover) track.coverUrl = cover
      }
    }
    await Promise.all(Array.from({ length: CONCURRENCY }, worker))
  }

  return { info, loading, loadingMore, error, load, loadMore }
}

async function readArtistCache(key: string): Promise<ArtistInfo | null> {
  try {
    const row = await db.artists.get(key)
    if (!row || isExpired(row.localCachedAt, TTL_ARTIST_DAYS)) return null
    return {
      name:              row.name,
      bio:               row.bio,
      listeners:         row.listeners,
      imageUrl:          isTrustedArtworkUrl(row.imageUrl) ? row.imageUrl : undefined,
      tags:              row.tags,
      topTracks:         row.topTracks.map(t => ({
        ...t,
        coverUrl: isTrustedArtworkUrl(t.coverUrl) ? t.coverUrl : undefined
      })),
      topTracksComplete: row.topTracksComplete,
      similar:           []   // no se persiste; se rellena lazy con fillSimilar
    }
  } catch {
    return null
  }
}

async function persistArtistCache(key: string, a: ArtistInfo): Promise<void> {
  try {
    await db.artists.put({
      key,
      name:              a.name,
      bio:               a.bio,
      listeners:         a.listeners,
      imageUrl:          isTrustedArtworkUrl(a.imageUrl) ? a.imageUrl : undefined,
      tags:              a.tags,
      topTracks:         a.topTracks.map(t => ({
        title: t.title,
        listeners: t.listeners,
        coverUrl: isTrustedArtworkUrl(t.coverUrl) ? t.coverUrl : undefined
      })),
      topTracksComplete: a.topTracksComplete,
      localCachedAt:     Date.now()
    } satisfies LocalArtist)
  } catch {
    /* best-effort */
  }
}

function stripLinks(html: string): string {
  return html.replace(/<a\b[^>]*>.*?<\/a>/gi, '').replace(/\s+/g, ' ').trim()
}
