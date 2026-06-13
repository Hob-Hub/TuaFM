import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type { Track } from '@/types/track.types'

// Cola de reproducción de playlist (tanto playlists de Dexie como colas efímeras
// que arrancan desde Buscar, el Top de un año o las canciones de un artista).
// Antes vivía como estado de módulo efímero en usePlayback; ahora es un store
// persistido, igual que radio y recomendaciones, para reanudarla al reabrir.
export const usePlaylistQueueStore = defineStore('playlistQueue', () => {
  const queue        = ref<Track[]>([])
  const currentIndex = ref(0)
  const playlistId   = ref<string | null>(null)   // id de la playlist de Dexie, o null si es efímera

  const isActive     = computed(() => queue.value.length > 0)
  const currentTrack = computed(() => queue.value[currentIndex.value] ?? null)
  const hasNext      = computed(() => currentIndex.value < queue.value.length - 1)
  const hasPrev      = computed(() => currentIndex.value > 0)

  function setQueue(tracks: Track[], startIndex: number, plId: string | null): void {
    queue.value        = tracks
    currentIndex.value = Math.max(0, Math.min(startIndex, tracks.length - 1))
    playlistId.value   = plId
  }

  function skipTo(i: number): void { currentIndex.value = Math.max(0, Math.min(i, queue.value.length - 1)) }
  function clear():          void { queue.value = []; currentIndex.value = 0; playlistId.value = null }

  function updateTrack(id: string, data: Partial<Track>): void {
    const idx = queue.value.findIndex(t => t.id === id)
    if (idx >= 0) queue.value[idx] = { ...queue.value[idx], ...data }
  }

  return {
    queue, currentIndex, playlistId, isActive, currentTrack, hasNext, hasPrev,
    setQueue, skipTo, clear, updateTrack
  }
}, {
  // Persistimos la cola para reanudar la reproducción al volver a abrir la app.
  persist: { pick: ['queue', 'currentIndex', 'playlistId'] }
})
