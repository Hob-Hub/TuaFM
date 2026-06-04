import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type { Track } from '@/types/track.types'

export const useRadioStore = defineStore('radio', () => {
  const queue        = ref<Track[]>([])
  const currentIndex = ref(0)
  const sourceLabel  = ref('')
  const activeChartId = ref('')
  const activeYear    = ref(new Date().getFullYear())
  const activeWeek    = ref(1)
  const activeLambda  = ref(0.008)
  const activeWindow  = ref(5)

  const isActive     = computed(() => queue.value.length > 0)
  const currentTrack = computed(() => queue.value[currentIndex.value] ?? null)
  const nextTrack    = computed(() => queue.value[currentIndex.value + 1] ?? null)
  const hasNext      = computed(() => currentIndex.value < queue.value.length - 1)
  const hasPrev      = computed(() => currentIndex.value > 0)

  function setQueue(tracks: Track[], label: string, params: {
    chartId: string; year: number; week: number; lambda: number; window: number
  }): void {
    queue.value         = tracks
    currentIndex.value  = 0
    sourceLabel.value   = label
    activeChartId.value = params.chartId
    activeYear.value    = params.year
    activeWeek.value    = params.week
    activeLambda.value  = params.lambda
    activeWindow.value  = params.window
  }

  function next():           void { if (hasNext.value) currentIndex.value++ }
  function prev():           void { if (hasPrev.value) currentIndex.value-- }
  function skipTo(i: number): void { currentIndex.value = Math.max(0, Math.min(i, queue.value.length - 1)) }
  function clear():          void { queue.value = []; currentIndex.value = 0; sourceLabel.value = '' }

  function updateTrack(id: string, data: Partial<Track>): void {
    const idx = queue.value.findIndex(t => t.id === id)
    if (idx >= 0) queue.value[idx] = { ...queue.value[idx], ...data }
  }

  return {
    queue, currentIndex, isActive, sourceLabel,
    activeChartId, activeYear, activeWeek, activeLambda, activeWindow,
    currentTrack, nextTrack, hasNext, hasPrev,
    setQueue, next, prev, skipTo, clear, updateTrack
  }
})
