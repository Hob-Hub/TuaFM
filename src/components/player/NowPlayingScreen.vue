<script setup lang="ts">
import { computed } from 'vue'
import { RouterLink } from 'vue-router'
import { usePlayerStore } from '@/stores/player.store'
import { useUiStore } from '@/stores/ui.store'
import { usePlayback } from '@/composables/usePlayback'
import { useYouTubePlayer } from '@/composables/useYouTubePlayer'
import TrackCover from '@/components/ui/TrackCover.vue'
import ProgressBar from '@/components/player/ProgressBar.vue'
import FavoriteButton from '@/components/ui/FavoriteButton.vue'

const player = usePlayerStore()
const ui = useUiStore()
const playback = usePlayback()
const yt = useYouTubePlayer()

const current = playback.currentTrack

const title  = computed(() => current.value?.titleDisplay  ?? current.value?.title  ?? '')
const artist = computed(() => current.value?.artistDisplay ?? current.value?.artist ?? '')

const repeatTitle = computed(() =>
  player.repeatMode === 'one' ? 'Repetir una' : player.repeatMode === 'all' ? 'Repetir todo' : 'Sin repetición')

function cycleRepeat(): void {
  player.repeatMode = player.repeatMode === 'none' ? 'all' : player.repeatMode === 'all' ? 'one' : 'none'
}

const modeLabel = computed(() => {
  switch (player.queueMode) {
    case 'radio': return 'Sonando en Radio'
    case 'recommendations': return 'Sonando en Recomendaciones'
    case 'playlist': return 'Sonando desde tu playlist'
    default: return 'Reproduciendo'
  }
})
</script>

<template>
  <div class="md:hidden fixed inset-0 z-50 flex flex-col bg-gradient-to-b from-brand/30 via-surface to-surface
              px-6 pt-5 pb-8" style="padding-bottom: max(2rem, env(safe-area-inset-bottom));">
    <!-- Cabecera -->
    <div class="flex items-center gap-3">
      <button class="p-2 -ml-2 rounded-lg text-white" aria-label="Cerrar" @click="ui.closeNowPlaying()">
        <svg viewBox="0 0 24 24" class="w-6 h-6" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 9l6 6 6-6"/></svg>
      </button>
      <span class="flex-1 text-center text-xs uppercase tracking-wider text-muted truncate">{{ modeLabel }}</span>
      <FavoriteButton v-if="current" :track="current" :size="24" />
    </div>

    <!-- Carátula -->
    <div class="flex-1 grid place-items-center py-6 min-h-0">
      <TrackCover
        :src="current?.coverUrl" :fallback-text="title" :alt="title"
        :size="320" rounded="rounded-3xl"
        class="w-full! h-auto! max-w-xs aspect-square shadow-2xl"
      />
    </div>

    <!-- Título + artista -->
    <div class="min-w-0 mb-5">
      <p class="font-display text-2xl font-extrabold truncate">{{ title || 'Nada sonando' }}</p>
      <RouterLink
        v-if="current"
        :to="{ name: 'artist', params: { name: artist } }"
        class="text-sm text-muted hover:text-white truncate block"
        @click="ui.closeNowPlaying()"
      >{{ artist }}</RouterLink>
    </div>

    <!-- Progreso -->
    <ProgressBar class="mb-4" />

    <!-- Transporte -->
    <div class="flex items-center justify-between">
      <button class="p-2 rounded-lg text-muted hover:text-white" :class="player.isShuffle && 'text-brand'"
              aria-label="Aleatorio" @click="player.isShuffle = !player.isShuffle">
        <svg viewBox="0 0 24 24" class="w-5 h-5" fill="none" stroke="currentColor" stroke-width="2"><path d="M16 3h5v5M4 20 21 3M21 16v5h-5M15 15l6 6M4 4l5 5"/></svg>
      </button>

      <button class="p-2 rounded-lg text-white/80 hover:text-white disabled:opacity-30"
              :disabled="!playback.hasPrev.value" aria-label="Anterior" @click="playback.prev()">
        <svg viewBox="0 0 24 24" class="w-8 h-8" fill="currentColor"><path d="M6 6h2v12H6zM20 6v12L9 12z"/></svg>
      </button>

      <button
        class="w-16 h-16 rounded-full bg-white text-surface grid place-items-center hover:scale-105 transition disabled:opacity-40"
        :disabled="!current"
        :aria-label="player.isPlaying ? 'Pausa' : 'Reproducir'"
        @click="playback.togglePlay()"
      >
        <svg v-if="player.isPlaying" viewBox="0 0 24 24" class="w-7 h-7" fill="currentColor"><rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/></svg>
        <svg v-else viewBox="0 0 24 24" class="w-7 h-7 ml-1" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
      </button>

      <button class="p-2 rounded-lg text-white/80 hover:text-white disabled:opacity-30"
              :disabled="!playback.hasNext.value" aria-label="Siguiente" @click="playback.next()">
        <svg viewBox="0 0 24 24" class="w-8 h-8" fill="currentColor"><path d="M16 6h2v12h-2zM4 6l11 6L4 18z"/></svg>
      </button>

      <button class="p-2 rounded-lg text-muted hover:text-white relative"
              :class="player.repeatMode !== 'none' && 'text-brand'"
              :title="repeatTitle" :aria-label="repeatTitle" @click="cycleRepeat()">
        <svg viewBox="0 0 24 24" class="w-5 h-5" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 2l4 4-4 4M3 11V9a4 4 0 0 1 4-4h14M7 22l-4-4 4-4M21 13v2a4 4 0 0 1-4 4H3"/></svg>
        <span v-if="player.repeatMode === 'one'" class="absolute -top-0.5 -right-0.5 text-[8px] font-bold">1</span>
      </button>
    </div>

    <!-- Acciones secundarias -->
    <div class="flex items-center justify-between mt-5">
      <button class="flex items-center gap-2 text-sm text-muted hover:text-white"
              :disabled="!current" @click="current && yt.toggleMute()">
        <svg v-if="player.isMuted || player.volume === 0" viewBox="0 0 24 24" class="w-5 h-5" fill="currentColor"><path d="M5 9v6h4l5 5V4L9 9H5zm13.5 3 2.5 2.5-1.5 1.5-2.5-2.5L17 13l-2.5-2.5L16 9l2.5 2.5L21 9l1.5 1.5L20 13z"/></svg>
        <svg v-else viewBox="0 0 24 24" class="w-5 h-5" fill="currentColor"><path d="M5 9v6h4l5 5V4L9 9H5zm11 3a4 4 0 0 0-2-3.46v6.92A4 4 0 0 0 16 12z"/></svg>
      </button>
      <button class="flex items-center gap-2 text-sm text-muted hover:text-white" aria-label="Ver cola"
              @click="ui.openQueue()">
        <svg viewBox="0 0 24 24" class="w-5 h-5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 6h11M4 12h11M4 18h7M17 14v6M17 20l3-2-3-2"/></svg>
        Cola
      </button>
      <button class="flex items-center gap-2 text-sm text-muted hover:text-white"
              :disabled="!current" @click="current && ui.openSaveToPlaylist(current)">
        <svg viewBox="0 0 24 24" class="w-5 h-5" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 5v14M5 12h14"/></svg>
        Guardar
      </button>
    </div>
  </div>
</template>
