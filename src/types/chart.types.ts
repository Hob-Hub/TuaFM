// Modelo de charts ANUAL: cada chart se sirve como una lista de "Top del año"
// (un ChartPeriod por año natural), generada desde la SQLite por
// chart-pipeline/build-charts.mjs.

export interface ChartRegistry {
  chartId:       string
  name:          string          // "España", "Estados Unidos"
  shortName:     string          // chip corto: "España", "Billboard"
  subtitle?:     string | null   // p. ej. "Billboard" bajo Estados Unidos
  country:       string          // ISO 3166-1 alpha-2
  flag:          string          // emoji
  language:      string
  listSize:      number          // tamaño "mostrado" del Top (p. ej. 100)
  startYear:     number
  endYear:       number
  totalPeriods:  number
  defaultLambda: number
  description:   string
}

export interface ChartSong {
  rank:            number        // posición en el Top consolidado del año
  position:        number        // alias de rank (UI genérica)
  score:           number        // puntuación anual (Σ 1/√posición de las semanas)
  peakPosition:    number        // mejor posición semanal alcanzada en el año
  weeksOnChart:    number        // semanas en lista ese año (1 en fuentes anuales)
  artist:          string        // artista principal normalizado (para cacheKey)
  artistDisplay:   string        // con feat., para UI
  title:           string        // normalizado (para cacheKey / agregación)
  titleDisplay:    string        // título original, para UI
  youtubeVideoId?: string
  coverUrl?:       string
  chartYear?:      number        // del catálogo: para mostrar año al cargar la cola
  duration?:       number        // ms, del catálogo: duración al cargar la cola
}

export interface ChartPeriod {
  chartId: string
  year:    number
  songs:   ChartSong[]           // rankeadas (songs[0] = Nº1 del año)
}

// ── Catálogo normalizado (public/catalog/*.json) ─────────────────────────────
// Los charts en disco son compactos y referencian estas entradas por id; la capa
// static.source las "hidrata" para reconstruir ChartSong y alimenta la caché de
// enriquecimiento (trackCache) y la vista de artista (useArtist) sin pegar a APIs.

export interface CatalogTrack {
  id:              number
  key:             string        // = makeCacheKey(artist, title)
  title:           string        // display
  artist:          string        // display (con feat.)
  artistId:        number        // artista principal → CatalogArtist.id
  artistIds?:      number[]      // TODOS los artistas (principal + colaboradores)
  album?:          string
  year?:           number        // año de edición (siembra de la DB; cobertura parcial)
  chartYear?:      number        // año de debut en el Top (derivado de los periodos)
  durationMs?:     number
  tags?:           string[]
  youtubeVideoId?: string
  coverUrl?:       string
  listeners?:      number
  lastfmUrl?:      string
  mbid?:           string        // MusicBrainz recording id
}

export interface CatalogArtistTopTrack {
  title:      string
  listeners?: number
}

export interface CatalogArtist {
  id:         number
  key:        string             // = normalizeStr(name)
  name:       string             // display
  bio?:       string
  listeners?: number
  imageUrl?:  string
  tags?:      string[]
  topTracks?: CatalogArtistTopTrack[]
  similar?:   string[]           // nombres de artistas similares (recos offline)
  mbid?:      string             // MusicBrainz artist id
}

export interface RadioCandidate {
  artist:          string
  artistDisplay:   string
  title:           string
  titleDisplay:    string
  youtubeVideoId?: string
  coverUrl?:       string
  chartYear?:      number        // año de debut en el Top (del catálogo)
  duration?:       number        // ms (del catálogo)
  weight:          number        // score anual × decaimiento temporal, acumulado
  score:           number        // score anual acumulado (sin decaimiento)
  appearances:     number        // en cuántos años del rango apareció
}
