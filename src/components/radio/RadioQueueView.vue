<script setup lang="ts">
import { useRadioStore } from '@/stores/radio.store'
import { usePlayerStore } from '@/stores/player.store'
import { usePlayback } from '@/composables/usePlayback'
import TrackItem from '@/components/playlist/TrackItem.vue'

const radio = useRadioStore()
const player = usePlayerStore()
const playback = usePlayback()

function isActive(i: number): boolean {
  return player.queueMode === 'radio' && radio.currentIndex === i
}
</script>

<template>
  <div v-if="radio.isActive">
    <div class="flex items-center justify-between mb-3">
      <div>
        <h2 class="font-display text-lg font-bold">En cola</h2>
        <p class="text-xs text-muted">{{ radio.sourceLabel }} · {{ radio.queue.length }} canciones</p>
      </div>
      <button class="text-sm text-muted hover:text-white" @click="radio.clear()">Limpiar</button>
    </div>

    <ul class="flex flex-col">
      <TrackItem
        v-for="(track, i) in radio.queue" :key="track.id"
        :track="track" mode="radio" :index="i"
        :is-active="isActive(i)"
        :is-playing="isActive(i) && player.isPlaying"
        @play="playback.playRadioIndex(i)"
      />
    </ul>
  </div>

  <div v-else class="rounded-2xl border border-dashed border-line p-10 text-center text-muted text-sm">
    Genera una radio para empezar. Elige la lista y el año, y ajusta la nostalgia.
  </div>
</template>
