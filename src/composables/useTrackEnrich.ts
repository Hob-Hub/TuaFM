import { ref } from 'vue'
import { resolveTrack, type EnrichResult } from '@/services/trackCache.service'
import type { Track } from '@/types/track.types'

/**
 * Wrapper reactivo sobre resolveTrack (la única puerta de enriquecimiento).
 * Los componentes nunca llaman a los services directamente; usan esto.
 */
export function useTrackEnrich() {
  const enriching = ref(false)
  const error     = ref<string | null>(null)

  async function enrich(track: Track): Promise<EnrichResult> {
    enriching.value = true
    error.value     = null
    try {
      // artistDisplay (nombre real con diacríticos) para las APIs externas;
      // artist (normalizado) define el cacheKey dentro de resolveTrack.
      return await resolveTrack(track.artist, track.title, track.youtubeVideoId, track.artistDisplay)
    } catch (e) {
      error.value = (e as Error).message
      return { enrichError: true }
    } finally {
      enriching.value = false
    }
  }

  return { enrich, enriching, error }
}
