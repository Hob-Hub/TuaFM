import { ref } from 'vue'
import { i18n } from '@/i18n'
import { makeCacheKey } from '@/db/local.db'
import { buildRecommendations } from '@/services/recommendations.service'
import { useRecommendationsStore } from '@/stores/recommendations.store'
import { usePlayerStore } from '@/stores/player.store'
import { useFavorites } from '@/composables/useFavorites'
import { getEngagementSeeds } from '@/composables/usePlayHistory'

export function useRecommendations() {
  const recStore    = useRecommendationsStore()
  const playerStore = usePlayerStore()
  const { favorites } = useFavorites()
  // generating solo aquí, no en el store
  const generating  = ref(false)
  const error       = ref<string | null>(null)

  async function generate(outputSize = 25): Promise<boolean> {
    if (!favorites.value || favorites.value.length < 3) {
      error.value = i18n.global.t('recs.needThreeError')
      return false
    }
    generating.value = true
    error.value      = null
    try {
      // Semillas = favoritos (delante, pesan más) + canciones más escuchadas por
      // comportamiento (engagement), sin repetir las que ya son favoritas.
      const favKeys    = new Set(favorites.value.map(f => makeCacheKey(f.artist, f.title)))
      const tasteSeeds = await getEngagementSeeds(8, favKeys).catch(() => [])
      const seeds      = [...favorites.value.map(f => ({ artist: f.artist, title: f.title })), ...tasteSeeds]
      const tracks = await buildRecommendations(seeds, outputSize)
      if (tracks.length === 0) {
        error.value = i18n.global.t('recs.noneFound')
        return false
      }
      recStore.setQueue(tracks)
      playerStore.queueMode = 'recommendations'
      return true
    } catch (e) {
      error.value = (e as Error).message
      return false
    } finally {
      generating.value = false
    }
  }

  return { generate, generating, error }
}
