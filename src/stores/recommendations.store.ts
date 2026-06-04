import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type { Track } from '@/types/track.types'

export const useRecommendationsStore = defineStore('recommendations', () => {
  // 'generating' vive en useRecommendations.ts, no aquí.
  const queue        = ref<Track[]>([])
  const currentIndex = ref(0)

  const isActive     = computed(() => queue.value.length > 0)
  const currentTrack = computed(() => queue.value[currentIndex.value] ?? null)
  const nextTrack    = computed(() => queue.value[currentIndex.value + 1] ?? null)
  const hasNext      = computed(() => currentIndex.value < queue.value.length - 1)
  const hasPrev      = computed(() => currentIndex.value > 0)

  function setQueue(tracks: Track[]): void { queue.value = tracks; currentIndex.value = 0 }
  function next():  void { if (hasNext.value) currentIndex.value++ }
  function prev():  void { if (hasPrev.value) currentIndex.value-- }
  function skipTo(i: number): void { currentIndex.value = Math.max(0, Math.min(i, queue.value.length - 1)) }
  function clear(): void { queue.value = []; currentIndex.value = 0 }

  function updateTrack(id: string, data: Partial<Track>): void {
    const idx = queue.value.findIndex(t => t.id === id)
    if (idx >= 0) queue.value[idx] = { ...queue.value[idx], ...data }
  }

  return {
    queue, currentIndex, isActive, currentTrack, nextTrack, hasNext, hasPrev,
    setQueue, next, prev, skipTo, clear, updateTrack
  }
})
