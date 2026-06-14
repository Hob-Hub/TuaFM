<script setup lang="ts">
import { ref, watch, nextTick } from 'vue'
import { useRadioStore } from '@/stores/radio.store'
import { usePlayerStore } from '@/stores/player.store'
import { usePlayback } from '@/composables/usePlayback'
import { useRadioQueue } from '@/composables/useRadioQueue'
import { scrollActiveIntoView } from '@/utils/scrollActive'
import TrackItem from '@/components/playlist/TrackItem.vue'

const radio = useRadioStore()
const player = usePlayerStore()
const playback = usePlayback()
const { extend, extending } = useRadioQueue()

const listEl = ref<HTMLElement | null>(null)

function isActive(i: number): boolean {
  return player.queueMode === 'radio' && radio.currentIndex === i
}

// Sigue la pista activa: la mantiene a la vista al avanzar la radio.
watch(() => radio.currentIndex, async () => {
  if (player.queueMode !== 'radio') return
  await nextTick()
  scrollActiveIntoView(listEl.value, radio.currentIndex)
})
</script>

<template>
  <div v-if="radio.isActive">
    <div class="flex items-center justify-between mb-3">
      <div>
        <h2 class="font-display text-lg font-bold">{{ $t('radio.queueTitle') }}</h2>
        <p class="text-xs text-muted">{{ radio.sourceLabel }} · {{ $t('common.songs', radio.queue.length) }}</p>
      </div>
      <button class="text-sm text-muted hover:text-white" @click="radio.clear()">{{ $t('radio.clearQueue') }}</button>
    </div>

    <ul ref="listEl" class="flex flex-col">
      <TrackItem
        v-for="(track, i) in radio.queue" :key="track.id"
        :track="track" mode="radio" :index="i"
        :is-active="isActive(i)"
        :is-playing="isActive(i) && player.isPlaying"
        @play="playback.playRadioIndex(i)"
      />
    </ul>

    <!-- Radio infinita: se amplía sola al avanzar, y a mano aquí. -->
    <div class="mt-3 flex flex-col items-center gap-1">
      <button
        class="text-sm text-muted hover:text-white disabled:opacity-50"
        :disabled="extending" @click="extend()"
      >
        {{ extending ? $t('common.loading') : $t('radio.loadMore') }}
      </button>
      <p class="text-[11px] text-muted/80">{{ $t('radio.infiniteHint') }}</p>
    </div>
  </div>

  <div v-else class="rounded-2xl border border-dashed border-line p-10 text-center text-muted text-sm">
    {{ $t('radio.emptyState') }}
  </div>
</template>
