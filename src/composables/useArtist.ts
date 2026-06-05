import { ref } from 'vue'
import { getArtistInfo, pickImage, getTrackCover } from '@/services/lastfm.service'
import { getArtistTopTracks } from '@/services/lastfm.similarity.service'

const TOP_TRACKS_LIMIT = 50

export interface ArtistTopTrack {
  title:     string
  listeners: number
  coverUrl?: string
}

export interface ArtistInfo {
  name:      string
  bio:       string
  listeners: number
  imageUrl?: string
  tags:      string[]
  topTracks: ArtistTopTrack[]
}

export function useArtist() {
  const info    = ref<ArtistInfo | null>(null)
  const loading = ref(false)
  const error   = ref<string | null>(null)

  async function load(artist: string): Promise<void> {
    loading.value = true
    error.value   = null
    info.value    = null
    try {
      const [infoRes, topRes] = await Promise.allSettled([
        getArtistInfo(artist),
        getArtistTopTracks(artist, TOP_TRACKS_LIMIT)
      ])

      if (infoRes.status !== 'fulfilled') {
        throw new Error('No se encontró información del artista')
      }
      const a = infoRes.value.artist
      const top: ArtistTopTrack[] = topRes.status === 'fulfilled'
        ? topRes.value.toptracks.track.map(t => ({ title: t.name, listeners: parseInt(t.listeners, 10) || 0 }))
        : []

      info.value = {
        name:      a.name,
        bio:       stripLinks(a.bio?.summary ?? ''),
        listeners: parseInt(a.stats?.listeners ?? '0', 10) || 0,
        imageUrl:  pickImage(a.image),
        tags:      (a.tags?.tag ?? []).map(t => t.name).slice(0, 6),
        topTracks: top
      }

      // Carátulas en segundo plano: no bloquean el render; cada una rellena su
      // fila al resolverse. Sin YouTube (no gasta cuota).
      void resolveCovers(a.name, info.value.topTracks)
    } catch (e) {
      error.value = (e as Error).message
    } finally {
      loading.value = false
    }
  }

  // Resuelve carátulas con concurrencia limitada para no saturar Last.fm.
  async function resolveCovers(artistName: string, tracks: ArtistTopTrack[]): Promise<void> {
    const CONCURRENCY = 5
    let i = 0
    async function worker(): Promise<void> {
      while (i < tracks.length) {
        const track = tracks[i++]
        const cover = await getTrackCover(artistName, track.title).catch(() => undefined)
        if (cover) track.coverUrl = cover
      }
    }
    await Promise.all(Array.from({ length: CONCURRENCY }, worker))
  }

  return { info, loading, error, load }
}

function stripLinks(html: string): string {
  return html.replace(/<a\b[^>]*>.*?<\/a>/gi, '').replace(/\s+/g, ' ').trim()
}
