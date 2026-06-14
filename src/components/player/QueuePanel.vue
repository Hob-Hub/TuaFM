<script setup lang="ts">
import { computed, ref, watch, onMounted, nextTick } from 'vue'
import { useI18n } from 'vue-i18n'
import { usePlayerStore } from '@/stores/player.store'
import { useRadioStore } from '@/stores/radio.store'
import { useRecommendationsStore } from '@/stores/recommendations.store'
import { usePlaylistQueueStore } from '@/stores/playlistQueue.store'
import { useUiStore } from '@/stores/ui.store'
import { usePlayback } from '@/composables/usePlayback'
import { scrollActiveIntoView } from '@/utils/scrollActive'
import type { Track } from '@/types/track.types'
import TrackItem from '@/components/playlist/TrackItem.vue'

const player = usePlayerStore()
const radio = useRadioStore()
const rec = useRecommendationsStore()
const pq = usePlaylistQueueStore()
const ui = useUiStore()
const playback = usePlayback()
const { t } = useI18n()

const tracks = computed<Track[]>(() => {
  switch (player.queueMode) {
    case 'radio':           return radio.queue
    case 'recommendations': return rec.queue
    case 'playlist':        return pq.queue
    default:                return []
  }
})

const currentIndex = computed(() => {
  switch (player.queueMode) {
    case 'radio':           return radio.currentIndex
    case 'recommendations': return rec.currentIndex
    case 'playlist':        return pq.currentIndex
    default:                return -1
  }
})

const sourceLabel = computed(() => {
  switch (player.queueMode) {
    case 'radio':           return radio.sourceLabel || t('queue.radio')
    case 'recommendations': return t('queue.recommendations')
    case 'playlist':        return t('queue.playlist')
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
            @play="jump(i)"
          />
        </ul>
        <div v-else class="grid place-items-center h-full text-sm text-muted px-6 text-center">
          {{ $t('queue.empty') }}
        </div>
      </div>
    </aside>
  </div>
</template>
