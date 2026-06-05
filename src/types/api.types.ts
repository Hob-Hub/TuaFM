// DTOs de infraestructura: lo que viaja entre Firestore/APIs y el dominio.

// ── Firestore DTOs ───────────────────────────────────────────────────────────

export interface FirestoreTrackCache {
  cacheKey:        string
  artist:          string
  title:           string
  album?:          string | null
  year?:           number | null
  duration?:       number | null
  coverUrl?:       string | null
  tags?:           string[]
  youtubeVideoId?: string | null
  youtubeCandidates?: string[]
  listeners?:      number | null
  cachedAt:        number
  ttlDays:         number
}

// ── Last.fm API responses ────────────────────────────────────────────────────

export interface LastfmImage {
  '#text': string
  size:    string
}

export interface LastfmTrackResponse {
  track: {
    name:     string
    duration: string
    url?:     string
    artist:   { name: string; url: string }
    album?:   { title: string; image: LastfmImage[] }
    toptags?: { tag: Array<{ name: string }> }
    listeners?: string
  }
}

export interface LastfmArtistResponse {
  artist: {
    name:  string
    url?:  string
    bio:   { summary: string; content?: string }
    tags:  { tag: Array<{ name: string; url?: string }> }
    image: LastfmImage[]
    stats: { listeners: string; playcount: string }
  }
}

export interface LastfmSearchResponse {
  results: {
    trackmatches: {
      track: Array<{
        name:      string
        artist:    string
        listeners: string
        url?:      string
        image:     LastfmImage[]
      }>
    }
  }
}

export interface LastfmArtistSearchResponse {
  results: {
    artistmatches: {
      artist: Array<{
        name:      string
        listeners: string
        url?:      string
        image:     LastfmImage[]
      }>
    }
  }
}

// ── Last.fm similarity / top responses ───────────────────────────────────────

export interface LastfmSimilarTrack {
  name:   string
  artist: { name: string }
  match:  string
}

export interface LastfmSimilarTracksResponse {
  similartracks: { track: LastfmSimilarTrack[] }
}

export interface LastfmSimilarArtist {
  name:  string
  match: string
}

export interface LastfmSimilarArtistsResponse {
  similarartists: { artist: LastfmSimilarArtist[] }
}

export interface LastfmTopTrack {
  name:      string
  artist:    { name: string }
  listeners: string
}

export interface LastfmArtistTopTracksResponse {
  toptracks: { track: LastfmTopTrack[] }
}

export interface LastfmTopTag {
  name:  string
  count: number
}

export interface LastfmTrackTopTagsResponse {
  toptags: { tag: LastfmTopTag[] }
}

export interface LastfmTagTopTracksResponse {
  tracks: { track: LastfmTopTrack[] }
}
