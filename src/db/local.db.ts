import Dexie, { type EntityTable } from 'dexie'
import type { Track } from '@/types/track.types'
import type { Playlist, FavoriteTrack, PlayHistoryEntry } from '@/types/playlist.types'

export interface LocalTrack extends Track {
  cacheKey:      string
  localCachedAt: number
}

const db = new Dexie('TuaFMDB') as Dexie & {
  tracks:    EntityTable<LocalTrack,       'id'>
  playlists: EntityTable<Playlist,         'id'>
  favorites: EntityTable<FavoriteTrack,    'cacheKey'>
  history:   EntityTable<PlayHistoryEntry, 'id'>
}

db.version(1).stores({
  tracks:    'id, cacheKey, artist, localCachedAt',
  playlists: 'id, name, updatedAt',
  favorites: 'cacheKey, artist, addedAt',
  history:   '++id, cacheKey, playedAt, queueMode'
})

// Normalización pura reexportada para conveniencia (definida en utils/normalize).
export { normalizeStr, makeCacheKey } from '@/utils/normalize'

export { db }
