export interface Track {
  id:              string        // nanoid local (efímero por sesión/dispositivo)
  title:           string
  artist:          string        // artista principal, normalizado (para cacheKey)
  artistDisplay?:  string        // con feat., para UI
  album?:          string
  year?:           number
  duration?:       number        // ms
  coverUrl?:       string
  tags?:           string[]
  youtubeVideoId?: string        // resuelto lazy o precargado desde chart
  lastfmUrl?:      string
  listeners?:      number
  enriched:        boolean
  enrichError?:    boolean
}

export type PlayerState = 'idle' | 'loading' | 'playing' | 'paused' | 'ended' | 'error'
export type RepeatMode  = 'none' | 'one' | 'all'
