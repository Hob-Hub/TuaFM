<script setup lang="ts">
import { computed } from 'vue'
import { usePlayerStore } from '@/stores/player.store'
import { useUiStore } from '@/stores/ui.store'
import { usePlayback } from '@/composables/usePlayback'
import { useYouTubePlayer } from '@/composables/useYouTubePlayer'
import NowPlaying from '@/components/player/NowPlaying.vue'
import ProgressBar from '@/components/player/ProgressBar.vue'
import BaseSlider from '@/components/ui/BaseSlider.vue'
import FavoriteButton from '@/components/ui/FavoriteButton.vue'

const player = usePlayerStore()
const ui = useUiStore()
const yt = useYouTubePlayer()
const playback = usePlayback()

const current = playback.currentTrack

// Tocar la pista en curso abre la vista a pantalla completa (solo en móvil:
// en escritorio ya se ve todo el control en la propia barra).
function expandNowPlaying(): void {
  if (!current.value) return
  if (window.matchMedia('(min-width: 768px)').matches) return
  ui.openNowPlaying()
}

const repeatTitle = computed(() =>
  player.repeatMode === 'one' ? 'Repetir una' : player.repeatMode === 'all' ? 'Repetir todo' : 'Sin repetición')

function cycleRepeat(): void {
  player.repeatMode = player.repeatMode === 'none' ? 'all' : player.repeatMode === 'all' ? 'one' : 'none'
}
function onVolume(v: number): void { yt.setVolume(v) }
</script>

<template>
  <footer class="bg-surface-2/95 backdrop-blur border-t border-line">
    <!-- Progreso a ancho completo (solo móvil; en desktop va en el centro) -->
    <ProgressBar v-if="current" compact class="md:hidden px-3 pt-2" />

    <div class="h-20 px-3 sm:px-4 grid grid-cols-[1fr_auto] md:grid-cols-3 items-center gap-3">
    <!-- Izquierda: pista actual -->
    <div class="flex items-center gap-2 min-w-0">
      <div
        class="min-w-0 flex-1 md:flex-none md:cursor-default"
        :class="current && 'cursor-pointer'"
        @click="expandNowPlaying"
      >
        <NowPlaying :track="current" />
      </div>
      <FavoriteButton v-if="current" :track="current" />
    </div>

    <!-- Centro: transporte + progreso -->
    <div class="flex flex-col items-center gap-1.5 justify-self-end md:justify-self-center w-full max-w-md">
      <div class="flex items-center gap-1 sm:gap-2">
        <button class="hidden md:inline-flex p-2 rounded-lg text-muted hover:text-white transition"
                :class="player.isShuffle && 'text-brand'"
                aria-label="Aleatorio" @click="player.isShuffle = !player.isShuffle">
          <svg viewBox="0 0 24 24" class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2"><path d="M16 3h5v5M4 20 21 3M21 16v5h-5M15 15l6 6M4 4l5 5"/></svg>
        </button>

        <button class="p-2 rounded-lg text-white/80 hover:text-white disabled:opacity-30"
                :disabled="!playback.hasPrev.value" aria-label="Anterior" @click="playback.prev()">
          <svg viewBox="0 0 24 24" class="w-5 h-5" fill="currentColor"><path d="M6 6h2v12H6zM20 6v12L9 12z"/></svg>
        </button>

        <button
          class="w-11 h-11 rounded-full bg-white text-surface grid place-items-center hover:scale-105 transition disabled:opacity-40"
          :disabled="!current"
          :aria-label="player.isPlaying ? 'Pausa' : 'Reproducir'"
          @click="playback.togglePlay()"
        >
          <svg v-if="player.isPlaying" viewBox="0 0 24 24" class="w-5 h-5" fill="currentColor"><rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/></svg>
          <svg v-else viewBox="0 0 24 24" class="w-5 h-5 ml-0.5" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
        </button>

        <button class="p-2 rounded-lg text-white/80 hover:text-white disabled:opacity-30"
                :disabled="!playback.hasNext.value" aria-label="Siguiente" @click="playback.next()">
          <svg viewBox="0 0 24 24" class="w-5 h-5" fill="currentColor"><path d="M16 6h2v12h-2zM4 6l11 6L4 18z"/></svg>
        </button>

        <button class="hidden md:inline-flex p-2 rounded-lg text-muted hover:text-white transition relative"
                :class="player.repeatMode !== 'none' && 'text-brand'"
                :title="repeatTitle" :aria-label="repeatTitle" @click="cycleRepeat()">
          <svg viewBox="0 0 24 24" class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 2l4 4-4 4M3 11V9a4 4 0 0 1 4-4h14M7 22l-4-4 4-4M21 13v2a4 4 0 0 1-4 4H3"/></svg>
          <span v-if="player.repeatMode === 'one'" class="absolute -top-0.5 -right-0.5 text-[8px] font-bold">1</span>
        </button>
      </div>
      <ProgressBar class="hidden md:flex" />
    </div>

    <!-- Derecha: volumen -->
    <div class="hidden md:flex items-center gap-2 justify-self-end">
      <!-- Modo clips (escucha rápida): cicla 0→15→30→45→60 s -->
      <button
        class="flex items-center gap-1 px-1.5 h-8 rounded-lg transition-colors"
        :class="player.clipMode ? 'text-brand' : 'text-muted hover:text-white'"
        :title="player.clipMode ? `Clips de ${player.clipSeconds}s · clic para cambiar` : 'Modo clips: escucha solo el trozo central de cada canción'"
        :aria-label="player.clipMode ? `Modo clips, ${player.clipSeconds} segundos` : 'Activar modo clips'"
        @click="player.cycleClip()"
      >
        <svg viewBox="0 0 24 24" class="w-5 h-5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
          <line x1="3" y1="12" x2="21" y2="12" /><rect x="8" y="7" width="8" height="10" rx="2" fill="currentColor" stroke="none" />
        </svg>
        <span v-if="player.clipMode" class="text-xs font-semibold tabular-nums">{{ player.clipSeconds }}s</span>
      </button>
      <button class="p-2 rounded-lg hover:text-white" :class="ui.queueOpen ? 'text-brand' : 'text-muted'"
              aria-label="Ver cola de reproducción" @click="ui.toggleQueue()">
        <svg viewBox="0 0 24 24" class="w-5 h-5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 6h11M4 12h11M4 18h7M17 14v6M17 20l3-2-3-2"/></svg>
      </button>
      <button class="p-2 rounded-lg text-muted hover:text-white" :aria-label="player.isMuted ? 'Activar sonido' : 'Silenciar'" @click="yt.toggleMute()">
        <svg v-if="player.isMuted || player.volume === 0" viewBox="0 0 24 24" class="w-5 h-5" fill="currentColor"><path d="M5 9v6h4l5 5V4L9 9H5zm13.5 3 2.5 2.5-1.5 1.5-2.5-2.5L17 13l-2.5-2.5L16 9l2.5 2.5L21 9l1.5 1.5L20 13z"/></svg>
        <svg v-else viewBox="0 0 24 24" class="w-5 h-5" fill="currentColor"><path d="M5 9v6h4l5 5V4L9 9H5zm11 3a4 4 0 0 0-2-3.46v6.92A4 4 0 0 0 16 12z"/></svg>
      </button>
      <BaseSlider
        class="w-24!"
        :model-value="player.isMuted ? 0 : player.volume"
        :min="0" :max="100"
        aria-label="Volumen"
        @update:model-value="onVolume"
      />
      <button class="p-2 rounded-lg text-muted hover:text-white" aria-label="Guardar pista en playlist"
              :disabled="!current" @click="current && ui.openSaveToPlaylist(current)">
        <svg viewBox="0 0 24 24" class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>
      </button>
    </div>
    </div>
  </footer>
</template>
