import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type { Track } from '@/types/track.types'
import { radioSourceLabel } from '@/utils/chartLabels'

export const useRadioStore = defineStore('radio', () => {
  const queue        = ref<Track[]>([])
  const currentIndex = ref(0)
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

  const isActive     = computed(() => queue.value.length > 0)
  const currentTrack = computed(() => queue.value[currentIndex.value] ?? null)
  const nextTrack    = computed(() => queue.value[currentIndex.value + 1] ?? null)
  const hasNext      = computed(() => currentIndex.value < queue.value.length - 1)
  const hasPrev      = computed(() => currentIndex.value > 0)

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

  function next():           void { if (hasNext.value) currentIndex.value++ }
  function prev():           void { if (hasPrev.value) currentIndex.value-- }
  function skipTo(i: number): void { currentIndex.value = Math.max(0, Math.min(i, queue.value.length - 1)) }
  function clear():          void { queue.value = []; currentIndex.value = 0; activeChartId.value = '' }

  function updateTrack(id: string, data: Partial<Track>): void {
    const idx = queue.value.findIndex(t => t.id === id)
    if (idx >= 0) queue.value[idx] = { ...queue.value[idx], ...data }
  }

  return {
    queue, currentIndex, isActive, sourceLabel,
    activeChartId, activeCountry, activeName, activeYear, activeLambda, activeWindow,
    currentTrack, nextTrack, hasNext, hasPrev,
    setQueue, appendQueue, next, prev, skipTo, clear, updateTrack
  }
}, {
  // Persistimos la cola y los parámetros para reanudar la radio al volver.
  // sourceLabel es derivado (computed): no se persiste, se recalcula del país.
  persist: {
    pick: ['queue', 'currentIndex', 'activeChartId', 'activeCountry', 'activeName',
           'activeYear', 'activeLambda', 'activeWindow']
  }
})
