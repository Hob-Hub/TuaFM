export interface Playlist {
  id:           string           // nanoid
  name:         string
  description?: string
  coverUrl?:    string
  trackIds:     string[]         // nanoid IDs de tracks en Dexie
  createdAt:    number
  updatedAt:    number
}

export interface FavoriteTrack {
  // cacheKey como PK: único identificador estable cross-session para una canción.
  cacheKey:  string              // `${artist_norm}::${title_norm}`
  artist:    string
  title:     string
  coverUrl?: string
  addedAt:   number
}

export interface PlayHistoryEntry {
  id?:       number              // autoincrement Dexie
  cacheKey:  string              // identificador estable
  trackId:   string              // nanoid de la sesión (puede variar)
  artist:    string
  title:     string
  coverUrl?: string
  queueMode: 'playlist' | 'radio' | 'recommendations'
  playedAt:  number
}
