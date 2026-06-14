import { ref, computed } from 'vue'
import type { Track } from '@/types/track.types'

/**
 * Estado y operaciones comunes a las tres colas (radio, recomendaciones,
 * playlist): un array de pistas con un índice activo. Cada store de cola lo
 * compone con `...createQueueState()` y añade lo suyo (parámetros de radio,
 * playlistId, setQueue/clear con sus campos extra). Antes este mismo bloque
 * estaba copiado carácter a carácter en los tres stores.
 */
export function createQueueState() {
  const queue        = ref<Track[]>([])
  const currentIndex = ref(0)

  const isActive     = computed(() => queue.value.length > 0)
  const currentTrack = computed(() => queue.value[currentIndex.value] ?? null)
  const hasNext      = computed(() => currentIndex.value < queue.value.length - 1)
  const hasPrev      = computed(() => currentIndex.value > 0)

  function next(): void { if (hasNext.value) currentIndex.value++ }
  function prev(): void { if (hasPrev.value) currentIndex.value-- }
  function skipTo(i: number): void {
    currentIndex.value = Math.max(0, Math.min(i, queue.value.length - 1))
  }

  function updateTrack(id: string, data: Partial<Track>): void {
    const idx = queue.value.findIndex(t => t.id === id)
    if (idx >= 0) queue.value[idx] = { ...queue.value[idx], ...data }
  }

  return {
    queue, currentIndex,
    isActive, currentTrack, hasNext, hasPrev,
    next, prev, skipTo, updateTrack,
  }
}
