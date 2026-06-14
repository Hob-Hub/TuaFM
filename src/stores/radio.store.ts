import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type { Track } from '@/types/track.types'
import { radioSourceLabel } from '@/utils/chartLabels'
import { createQueueState } from '@/stores/queueState'

export const useRadioStore = defineStore('radio', () => {
  const base = createQueueState()
  const { queue, currentIndex } = base

  const activeChartId = ref('')
  const activeCountry = ref('')   // ISO del país: el nombre se localiza en runtime
  const activeName    = ref('')   // nombre original (fallback si no hay país/clave)
  const activeYear    = ref(new Date().getFullYear())
  const activeLambda  = ref(0.35)
  const activeWindow  = ref(6)

  // Etiqueta de fuente derivada (no horneada): se relocaliza al cambiar de idioma.
  const sourceLabel = computed(() =>
    activeChartId.value
      ? radioSourceLabel(activeCountry.value, activeYear.value, activeName.value)
      : '',
  )

  function setQueue(tracks: Track[], params: {
    chartId: string; country: string; name: string
    year: number; lambda: number; window: number
  }): void {
    queue.value         = tracks
    currentIndex.value  = 0
    activeChartId.value = params.chartId
    activeCountry.value = params.country
    activeName.value    = params.name
    activeYear.value    = params.year
    activeLambda.value  = params.lambda
    activeWindow.value  = params.window
  }

  /** Añade pistas al final de la cola (radio infinita). */
  function appendQueue(tracks: Track[]): void {
    if (tracks.length) queue.value.push(...tracks)
  }

  function clear(): void { queue.value = []; currentIndex.value = 0; activeChartId.value = '' }

  return {
    ...base,
    activeChartId, activeCountry, activeName, activeYear, activeLambda, activeWindow,
    sourceLabel,
    setQueue, appendQueue, clear,
  }
}, {
  // Persistimos la cola y los parámetros para reanudar la radio al volver.
  // sourceLabel es derivado (computed): no se persiste, se recalcula del país.
  persist: {
    pick: ['queue', 'currentIndex', 'activeChartId', 'activeCountry', 'activeName',
           'activeYear', 'activeLambda', 'activeWindow']
  }
})
