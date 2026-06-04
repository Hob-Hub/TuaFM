import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type { PlayerState, RepeatMode } from '@/types/track.types'
import type { QueueMode } from '@/types/queue.types'

export const usePlayerStore = defineStore('player', () => {
  const currentTrackId    = ref<string | null>(null)
  const currentPlaylistId = ref<string | null>(null)
  const queueMode         = ref<QueueMode>('idle')
  const state             = ref<PlayerState>('idle')
  const currentTime       = ref(0)
  const duration          = ref(0)
  const volume            = ref(80)
  const isMuted           = ref(false)
  const repeatMode        = ref<RepeatMode>('none')
  const isShuffle         = ref(false)

  const progress  = computed(() => duration.value > 0 ? (currentTime.value / duration.value) * 100 : 0)
  const isPlaying = computed(() => state.value === 'playing')

  // Resuelve el modo de cola activo. Las colas efímeras (radio, recommendations)
  // se verifican en sus stores desde PlayerBar.vue con imports dinámicos para
  // evitar dependencias circulares.
  const effectiveQueueMode = computed<QueueMode>(() => queueMode.value)

  return {
    currentTrackId, currentPlaylistId, queueMode, effectiveQueueMode,
    state, currentTime, duration, volume, isMuted, repeatMode, isShuffle,
    progress, isPlaying
  }
}, {
  persist: { pick: ['volume', 'isMuted', 'repeatMode', 'isShuffle'] }
})
