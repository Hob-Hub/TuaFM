import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { Track } from '@/types/track.types'
import { createQueueState } from '@/stores/queueState'

// Cola de reproducción de playlist (tanto playlists de Dexie como colas efímeras
// que arrancan desde Buscar, el Top de un año o las canciones de un artista).
// Antes vivía como estado de módulo efímero en usePlayback; ahora es un store
// persistido, igual que radio y recomendaciones, para reanudarla al reabrir.
export const usePlaylistQueueStore = defineStore('playlistQueue', () => {
  const base = createQueueState()
  const { queue, currentIndex } = base
  const playlistId = ref<string | null>(null)   // id de la playlist de Dexie, o null si es efímera

  function setQueue(tracks: Track[], startIndex: number, plId: string | null): void {
    queue.value        = tracks
    currentIndex.value = Math.max(0, Math.min(startIndex, tracks.length - 1))
    playlistId.value   = plId
  }

  function clear(): void { queue.value = []; currentIndex.value = 0; playlistId.value = null }

  return { ...base, playlistId, setQueue, clear }
}, {
  // Persistimos la cola para reanudar la reproducción al volver a abrir la app.
  persist: { pick: ['queue', 'currentIndex', 'playlistId'] }
})
