export interface Track {
  id:              string        // nanoid local (efímero por sesión/dispositivo)
  title:           string
  titleDisplay?:   string        // título con mayúsculas (de charts), para UI
  artist:          string        // artista principal, normalizado (para cacheKey)
  artistDisplay?:  string        // con feat., para UI
  album?:          string
  year?:           number        // año de edición (Last.fm/DB; cobertura parcial)
  chartYear?:      number        // año de debut en el Top (de los charts; 100% para catálogo)
  duration?:       number        // ms
  coverUrl?:       string
  tags?:           string[]
  youtubeVideoId?: string        // mejor candidato (resuelto lazy o precargado desde chart)
  youtubeCandidates?: string[]   // videoIds alternativos rankeados, para fallback en onError
  lastfmUrl?:      string
  listeners?:      number
  enriched:        boolean
  enrichError?:    boolean
}

export type PlayerState = 'idle' | 'loading' | 'playing' | 'paused' | 'ended' | 'error'
export type RepeatMode  = 'none' | 'one' | 'all'
