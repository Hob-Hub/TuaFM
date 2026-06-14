import { defineStore } from 'pinia'
import type { Track } from '@/types/track.types'
import { createQueueState } from '@/stores/queueState'

export const useRecommendationsStore = defineStore('recommendations', () => {
  // 'generating' vive en useRecommendations.ts, no aquí.
  const base = createQueueState()
  const { queue, currentIndex } = base

  function setQueue(tracks: Track[]): void { queue.value = tracks; currentIndex.value = 0 }
  function clear(): void { queue.value = []; currentIndex.value = 0 }

  return { ...base, setQueue, clear }
}, {
  // Persistimos la cola para reanudar las recomendaciones al volver, como la radio.
  persist: { pick: ['queue', 'currentIndex'] }
})
