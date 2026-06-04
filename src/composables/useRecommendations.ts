import { ref } from 'vue'
import { buildRecommendations } from '@/services/recommendations.service'
import { useRecommendationsStore } from '@/stores/recommendations.store'
import { usePlayerStore } from '@/stores/player.store'
import { useFavorites } from '@/composables/useFavorites'

export function useRecommendations() {
  const recStore    = useRecommendationsStore()
  const playerStore = usePlayerStore()
  const { favorites } = useFavorites()
  // generating solo aquí, no en el store
  const generating  = ref(false)
  const error       = ref<string | null>(null)

  async function generate(outputSize = 25): Promise<boolean> {
    if (!favorites.value || favorites.value.length < 3) {
      error.value = 'Necesitas al menos 3 favoritos para generar recomendaciones'
      return false
    }
    generating.value = true
    error.value      = null
    try {
      const tracks = await buildRecommendations(favorites.value, outputSize)
      if (tracks.length === 0) {
        error.value = 'No se encontraron recomendaciones. Prueba con más favoritos.'
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
