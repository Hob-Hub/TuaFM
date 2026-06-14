<script setup lang="ts">
import { ref, watch, onMounted, nextTick } from 'vue'
import { usePlayerStore } from '@/stores/player.store'
import { useUiStore } from '@/stores/ui.store'
import { usePlayback } from '@/composables/usePlayback'
import { scrollActiveIntoView } from '@/utils/scrollActive'
import TrackItem from '@/components/playlist/TrackItem.vue'

const player = usePlayerStore()
const ui = useUiStore()
const playback = usePlayback()

// La cola activa (pistas, índice, etiqueta de fuente) la resuelve usePlayback;
// el panel solo la renderiza.
const tracks       = playback.queueTracks
const currentIndex = playback.queueIndex
const sourceLabel  = playback.queueSourceLabel

const listEl = ref<HTMLElement | null>(null)
async function followActive(): Promise<void> {
  await nextTick()
  scrollActiveIntoView(listEl.value, currentIndex.value)
}
onMounted(followActive)                    // centra la activa al abrir el panel
watch(currentIndex, followActive)          // y la sigue al cambiar de pista
</script>

<template>
  <div class="fixed inset-0 z-50 flex justify-end">
    <div class="absolute inset-0 bg-black/50" @click="ui.closeQueue()" />

    <aside class="queue-panel relative w-full sm:w-96 max-w-full h-full bg-surface border-l border-line flex flex-col shadow-2xl">
      <header class="flex items-center justify-between px-4 h-14 border-b border-line shrink-0">
        <div class="min-w-0">
          <h2 class="font-display font-bold leading-tight">{{ $t('queue.title') }}</h2>
          <p class="text-xs text-muted truncate">{{ sourceLabel }}</p>
        </div>
        <button class="p-2 -mr-2 rounded-lg text-muted hover:text-white" :aria-label="$t('queue.close')" @click="ui.closeQueue()">
          <svg viewBox="0 0 24 24" class="w-5 h-5" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 6l12 12M18 6 6 18"/></svg>
        </button>
      </header>

      <div class="flex-1 overflow-y-auto p-2">
        <ul v-if="tracks.length" ref="listEl" class="flex flex-col">
          <TrackItem
            v-for="(track, i) in tracks" :key="track.id"
            :track="track" :mode="player.queueMode" :index="i"
            :is-active="i === currentIndex"
            :is-playing="i === currentIndex && player.isPlaying"
            @play="playback.playIndex(i)"
          />
        </ul>
        <div v-else class="grid place-items-center h-full text-sm text-muted px-6 text-center">
          {{ $t('queue.empty') }}
        </div>
      </div>
    </aside>
  </div>
</template>
