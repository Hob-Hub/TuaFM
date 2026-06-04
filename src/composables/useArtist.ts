import { ref } from 'vue'
import { getArtistInfo, pickImage } from '@/services/lastfm.service'
import { getArtistTopTracks } from '@/services/lastfm.similarity.service'

export interface ArtistInfo {
  name:      string
  bio:       string
  listeners: number
  imageUrl?: string
  tags:      string[]
  topTracks: { title: string; listeners: number }[]
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
        getArtistTopTracks(artist, 10)
      ])

      if (infoRes.status !== 'fulfilled') {
        throw new Error('No se encontró información del artista')
      }
      const a = infoRes.value.artist
      const top = topRes.status === 'fulfilled'
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
    } catch (e) {
      error.value = (e as Error).message
    } finally {
      loading.value = false
    }
  }

  return { info, loading, error, load }
}

function stripLinks(html: string): string {
  return html.replace(/<a\b[^>]*>.*?<\/a>/gi, '').replace(/\s+/g, ' ').trim()
}
