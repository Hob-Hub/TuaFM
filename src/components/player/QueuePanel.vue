<script setup lang="ts">
import { computed } from 'vue'
import { usePlayerStore } from '@/stores/player.store'
import { useRadioStore } from '@/stores/radio.store'
import { useRecommendationsStore } from '@/stores/recommendations.store'
import { useUiStore } from '@/stores/ui.store'
import { usePlayback } from '@/composables/usePlayback'
import type { Track } from '@/types/track.types'
import TrackItem from '@/components/playlist/TrackItem.vue'

const player = usePlayerStore()
const radio = useRadioStore()
const rec = useRecommendationsStore()
const ui = useUiStore()
const playback = usePlayback()

const tracks = computed<Track[]>(() => {
  switch (player.queueMode) {
    case 'radio':           return radio.queue
    case 'recommendations': return rec.queue
    case 'playlist':        return playback.playlistQueue.value
    default:                return []
  }
})

const currentIndex = computed(() => {
  switch (player.queueMode) {
    case 'radio':           return radio.currentIndex
    case 'recommendations': return rec.currentIndex
    case 'playlist':        return playback.playlistIndex.value
    default:                return -1
  }
})

const sourceLabel = computed(() => {
  switch (player.queueMode) {
    case 'radio':           return radio.sourceLabel || 'Radio'
    case 'recommendations': return 'Recomendaciones'
    case 'playlist':        return 'Tu playlist'
    default:                return ''
  }
})

function jump(i: number): void {
  switch (player.queueMode) {
    case 'radio':           playback.playRadioIndex(i); break
    case 'recommendations': playback.playRecIndex(i); break
    case 'playlist':        playback.playPlaylistIndex(i); break
  }
}
</script>

<template>
  <div class="fixed inset-0 z-50 flex justify-end">
    <div class="absolute inset-0 bg-black/50" @click="ui.closeQueue()" />

    <aside class="relative w-full sm:w-96 max-w-full h-full bg-surface border-l border-line flex flex-col shadow-2xl">
      <header class="flex items-center justify-between px-4 h-14 border-b border-line shrink-0">
        <div class="min-w-0">
          <h2 class="font-display font-bold leading-tight">En cola</h2>
          <p class="text-xs text-muted truncate">{{ sourceLabel }}</p>
        </div>
        <button class="p-2 -mr-2 rounded-lg text-muted hover:text-white" aria-label="Cerrar cola" @click="ui.closeQueue()">
          <svg viewBox="0 0 24 24" class="w-5 h-5" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 6l12 12M18 6 6 18"/></svg>
        </button>
      </header>

      <div class="flex-1 overflow-y-auto p-2">
        <ul v-if="tracks.length" class="flex flex-col">
          <TrackItem
            v-for="(track, i) in tracks" :key="track.id"
            :track="track" :mode="player.queueMode" :index="i"
            :is-active="i === currentIndex"
            :is-playing="i === currentIndex && player.isPlaying"
            @play="jump(i)"
          />
        </ul>
        <div v-else class="grid place-items-center h-full text-sm text-muted px-6 text-center">
          No hay nada en cola. Genera una radio o reproduce una playlist.
        </div>
      </div>
    </aside>
  </div>
</template>
