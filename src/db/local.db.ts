import Dexie, { type EntityTable } from 'dexie'
import type { Track } from '@/types/track.types'
import type { Playlist, FavoriteTrack, PlayHistoryEntry, FailedTrack } from '@/types/playlist.types'

export interface LocalTrack extends Track {
  cacheKey:      string
  localCachedAt: number
}

/** Top-track de la ficha de artista (con carátula resuelta perezosamente). */
export interface LocalArtistTopTrack {
  title:      string
  listeners:  number
  coverUrl?:  string
}

/**
 * Ficha de artista cacheada en Dexie. Cubre los artistas que NO están en el
 * catálogo estático (feats, recomendados, buscados): se piden a Last.fm una vez
 * y se reusan en sesiones siguientes. `topTracksComplete` marca si ya se trajo
 * la lista ampliada ("Mostrar más", top-50) o solo el top inicial.
 */
export interface LocalArtist {
  key:                string   // = normalizeStr(name)
  name:               string
  bio:                string
  listeners:          number
  imageUrl?:          string
  tags:               string[]
  topTracks:          LocalArtistTopTrack[]
  topTracksComplete:  boolean
  localCachedAt:      number
}

/** Carátula resuelta para un (artista,título), persistida para sobrevivir a la
 *  recarga (antes solo vivía en un Map en memoria que se perdía cada sesión). */
export interface LocalCover {
  cacheKey:      string   // = makeCacheKey(artist, title)
  coverUrl:      string
  localCachedAt: number
}

/** Entrada genérica de caché para respuestas de Last.fm (grafo de similitud:
 *  getSimilar*, top tracks, tags). Clave = método + argumentos normalizados. */
export interface LocalLastfmCache {
  key:           string
  json:          unknown
  localCachedAt: number
}

const db = new Dexie('TuaFMDB') as Dexie & {
  tracks:       EntityTable<LocalTrack,       'id'>
  playlists:    EntityTable<Playlist,         'id'>
  favorites:    EntityTable<FavoriteTrack,    'cacheKey'>
  history:      EntityTable<PlayHistoryEntry, 'id'>
  artists:      EntityTable<LocalArtist,      'key'>
  covers:       EntityTable<LocalCover,       'cacheKey'>
  lastfmCache:  EntityTable<LocalLastfmCache, 'key'>
  failedTracks: EntityTable<FailedTrack,      'cacheKey'>
}

db.version(1).stores({
  tracks:    'id, cacheKey, artist, localCachedAt',
  playlists: 'id, name, updatedAt',
  favorites: 'cacheKey, artist, addedAt',
  history:   '++id, cacheKey, playedAt, queueMode'
})

// v2 — capas de caché persistente para no re-pedir a Last.fm lo ya resuelto:
// ficha de artista (no-catálogo), carátulas y grafo de similitud. Migración
// aditiva: Dexie conserva los datos de v1 (tracks, playlists, favoritos, historial).
db.version(2).stores({
  tracks:      'id, cacheKey, artist, localCachedAt',
  playlists:   'id, name, updatedAt',
  favorites:   'cacheKey, artist, addedAt',
  history:     '++id, cacheKey, playedAt, queueMode',
  artists:     'key, name, localCachedAt',
  covers:      'cacheKey, localCachedAt',
  lastfmCache: 'key, localCachedAt'
})

// v3 — registro de pistas no reproducibles (para revisarlas y arreglarlas luego).
// Migración aditiva: solo añade una tabla nueva; el resto se conserva.
db.version(3).stores({
  tracks:       'id, cacheKey, artist, localCachedAt',
  playlists:    'id, name, updatedAt',
  favorites:    'cacheKey, artist, addedAt',
  history:      '++id, cacheKey, playedAt, queueMode',
  artists:      'key, name, localCachedAt',
  covers:       'cacheKey, localCachedAt',
  lastfmCache:  'key, localCachedAt',
  failedTracks: 'cacheKey, lastFailedAt, reason'
})

// Normalización pura reexportada para conveniencia (definida en utils/normalize).
export { normalizeStr, makeCacheKey } from '@/utils/normalize'

export { db }
