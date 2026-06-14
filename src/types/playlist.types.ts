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
  // ── Señales de escucha (engagement), rellenadas al SALIR de la pista ──────────
  // Capturan cuánto se escuchó de verdad, para alimentar a futuro las
  // recomendaciones (escuchas completas vs. saltos, y el "rescate" en modo clips).
  listenedMs?:  number           // tiempo real sonando (acumulado, ignora pausas)
  durationMs?:  number           // duración real del vídeo
  clipSeconds?: number           // longitud del clip si sonó en modo clips (0 = entera)
  rescued?:     boolean          // en clips, dio "atrás" para oírla entera → señal fuerte
}

/**
 * Pista que NO se pudo reproducir (ningún candidato de YouTube arrancó, o no se
 * encontró vídeo). Se persiste para poder revisarlas y arreglarlas luego. Clave =
 * cacheKey, así repetir el fallo solo incrementa el contador en vez de duplicar.
 */
export interface FailedTrack {
  cacheKey:      string          // PK estable (artist::title normalizados)
  artist:        string
  title:         string
  reason:        'no-video' | 'playback-error'
  triedVideoIds: string[]        // candidatos que se intentaron (vacío si no había vídeo)
  queueMode:     'playlist' | 'radio' | 'recommendations'
  firstFailedAt: number
  lastFailedAt:  number
  count:         number          // veces que ha fallado
}
