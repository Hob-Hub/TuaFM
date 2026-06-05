import type { CatalogTrack, CatalogArtist } from '@/types/chart.types'

/**
 * Catálogo estático (public/catalog/{tracks,artists}.json): tracks y artistas
 * deduplicados y ya enriquecidos en build (Last.fm + datos de la DB). Es la
 * PRIMERA capa de caché en runtime:
 *   · hidrata los charts compactos (join por trackId),
 *   · siembra el enriquecimiento de pistas (trackCache) sin pegar a APIs,
 *   · sirve la ficha de artista (useArtist) offline.
 *
 * Carga perezosa y cacheada en memoria (mismo patrón que chartData/static.source).
 */

const BASE = `${import.meta.env.BASE_URL}catalog/`

let tracksPromise:  Promise<Map<number, CatalogTrack>> | null = null
let trackByKeyPromise: Promise<Map<string, CatalogTrack>> | null = null
let artistsPromise: Promise<{ byKey: Map<string, CatalogArtist>; byName: Map<string, CatalogArtist> }> | null = null

async function fetchJson<T>(file: string): Promise<T> {
  const res = await fetch(`${BASE}${file}`)
  if (!res.ok) throw new Error(`[catalog] ${file} → HTTP ${res.status}`)
  return res.json() as Promise<T>
}

function loadTracks(): Promise<Map<number, CatalogTrack>> {
  if (!tracksPromise) {
    tracksPromise = fetchJson<{ tracks: CatalogTrack[] }>('tracks.json')
      .then(d => new Map(d.tracks.map(t => [t.id, t])))
      .catch(err => { tracksPromise = null; throw err })
  }
  return tracksPromise
}

/** Índice por id, para hidratar los periodos de chart compactos. */
export function getTracksById(): Promise<Map<number, CatalogTrack>> {
  return loadTracks()
}

/** Índice por cacheKey, para la caché de enriquecimiento (trackCache). */
export function getTracksByKey(): Promise<Map<string, CatalogTrack>> {
  if (!trackByKeyPromise) {
    trackByKeyPromise = loadTracks()
      .then(byId => {
        const m = new Map<string, CatalogTrack>()
        for (const t of byId.values()) m.set(t.key, t)
        return m
      })
      .catch(err => { trackByKeyPromise = null; throw err })
  }
  return trackByKeyPromise
}

export async function getTrackByKey(cacheKey: string): Promise<CatalogTrack | null> {
  try {
    return (await getTracksByKey()).get(cacheKey) ?? null
  } catch {
    return null   // sin catálogo → el caller cae al camino normal (Dexie/APIs)
  }
}

function loadArtists() {
  if (!artistsPromise) {
    artistsPromise = fetchJson<{ artists: CatalogArtist[] }>('artists.json')
      .then(d => {
        const byKey  = new Map<string, CatalogArtist>()
        const byName = new Map<string, CatalogArtist>()
        for (const a of d.artists) {
          byKey.set(a.key, a)
          byName.set(a.name.toLowerCase(), a)
        }
        return { byKey, byName }
      })
      .catch(err => { artistsPromise = null; throw err })
  }
  return artistsPromise
}

export async function getArtistByKey(artistKey: string): Promise<CatalogArtist | null> {
  try {
    const { byKey } = await loadArtists()
    return byKey.get(artistKey) ?? null
  } catch {
    return null
  }
}
