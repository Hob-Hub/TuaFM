import type { CatalogTrack, CatalogArtist } from '@/types/chart.types'

/**
 * Catálogo estático (public/catalog/{tracks,artists}.json): tracks y artistas
 * deduplicados y ya enriquecidos en build (Last.fm + Deezer + datos de la DB). Es
 * la PRIMERA capa de caché en runtime:
 *   · hidrata los charts compactos (join por trackId),
 *   · siembra el enriquecimiento de pistas (trackCache) sin pegar a APIs,
 *   · sirve la ficha de artista (useArtist) y las imágenes de Buscar offline.
 *
 * Cada fichero trae `aliases` (key alternativa → id canónico) para que grafías
 * duplicadas que se fusionaron (p. ej. "kesha"/"ke$ha") sigan resolviendo.
 *
 * Carga perezosa y cacheada en memoria (mismo patrón que chartData/static.source).
 */

const BASE = `${import.meta.env.BASE_URL}catalog/`

interface TrackIndex  { byId: Map<number, CatalogTrack>;  byKey: Map<string, CatalogTrack> }
interface ArtistIndex { byKey: Map<string, CatalogArtist>; byName: Map<string, CatalogArtist> }

let tracksPromise:  Promise<TrackIndex>  | null = null
let artistsPromise: Promise<ArtistIndex> | null = null

async function fetchJson<T>(file: string): Promise<T> {
  const res = await fetch(`${BASE}${file}`)
  if (!res.ok) throw new Error(`[catalog] ${file} → HTTP ${res.status}`)
  return res.json() as Promise<T>
}

function loadTracks(): Promise<TrackIndex> {
  if (!tracksPromise) {
    tracksPromise = fetchJson<{ tracks: CatalogTrack[]; aliases?: Record<string, number> }>('tracks.json')
      .then(d => {
        const byId  = new Map(d.tracks.map(t => [t.id, t]))
        const byKey = new Map(d.tracks.map(t => [t.key, t]))
        for (const [key, id] of Object.entries(d.aliases ?? {})) {
          const t = byId.get(id); if (t) byKey.set(key, t)
        }
        return { byId, byKey }
      })
      .catch(err => { tracksPromise = null; throw err })
  }
  return tracksPromise
}

/** Índice por id, para hidratar los periodos de chart compactos. */
export async function getTracksById(): Promise<Map<number, CatalogTrack>> {
  return (await loadTracks()).byId
}

/**
 * Muestra de descubrimiento para Home: pistas notables del catálogo (con
 * carátula y oyentes) barajadas, para una estantería "Descubre" que cambia en
 * cada carga. 100% offline (catálogo estático), sin pegar a ninguna API.
 */
export async function getDiscoveryTracks(limit = 12): Promise<CatalogTrack[]> {
  try {
    const { byId } = await loadTracks()
    const pool = [...byId.values()]
      .filter(t => t.coverUrl && (t.listeners ?? 0) > 0)
      .sort((a, b) => (b.listeners ?? 0) - (a.listeners ?? 0))
      .slice(0, 400)   // techo "notable" para no mostrar la cola de poca escucha
    // Fisher–Yates parcial: baraja y devuelve los primeros `limit`.
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1))
      ;[pool[i], pool[j]] = [pool[j]!, pool[i]!]
    }
    return pool.slice(0, limit)
  } catch {
    return []   // sin catálogo → Home omite la sección
  }
}

export async function getTrackByKey(cacheKey: string): Promise<CatalogTrack | null> {
  try {
    return (await loadTracks()).byKey.get(cacheKey) ?? null
  } catch {
    return null   // sin catálogo → el caller cae al camino normal (Dexie/APIs)
  }
}

function loadArtists(): Promise<ArtistIndex> {
  if (!artistsPromise) {
    artistsPromise = fetchJson<{ artists: CatalogArtist[]; aliases?: Record<string, number> }>('artists.json')
      .then(d => {
        const byId   = new Map(d.artists.map(a => [a.id, a]))
        const byKey  = new Map(d.artists.map(a => [a.key, a]))
        const byName = new Map(d.artists.map(a => [a.name.toLowerCase(), a]))
        for (const [key, id] of Object.entries(d.aliases ?? {})) {
          const a = byId.get(id); if (a) byKey.set(key, a)
        }
        return { byKey, byName }
      })
      .catch(err => { artistsPromise = null; throw err })
  }
  return artistsPromise
}

export async function getArtistByKey(artistKey: string): Promise<CatalogArtist | null> {
  try {
    return (await loadArtists()).byKey.get(artistKey) ?? null
  } catch {
    return null
  }
}
