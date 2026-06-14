<script setup lang="ts">
import { computed } from 'vue'
import { useRecommendations } from '@/composables/useRecommendations'
import { useRecommendationsStore } from '@/stores/recommendations.store'
import { useFavorites } from '@/composables/useFavorites'
import { usePlayerStore } from '@/stores/player.store'
import { usePlayback } from '@/composables/usePlayback'
import TrackItem from '@/components/playlist/TrackItem.vue'
import BaseButton from '@/components/ui/BaseButton.vue'

const { generate, generating, error } = useRecommendations()
const recStore = useRecommendationsStore()
const { favorites } = useFavorites()
const player = usePlayerStore()
const playback = usePlayback()

const favCount = computed(() => favorites.value.length)
const canGenerate = computed(() => favCount.value >= 3)

function isActive(i: number): boolean {
  return player.queueMode === 'recommendations' && recStore.currentIndex === i
}

// Genera y arranca la reproducción al instante, igual que "Generar radio".
async function onGenerate(): Promise<void> {
  const ok = await generate()
  if (ok) playback.playRecIndex(0)
}
</script>

<template>
  <div class="p-5 sm:p-8 max-w-3xl mx-auto">
    <header class="mb-6">
      <h1 class="font-display text-2xl sm:text-3xl font-extrabold">{{ $t('recs.title') }}</h1>
      <p class="text-muted text-sm mt-1">{{ $t('recs.subtitle') }}</p>
    </header>

    <div class="rounded-2xl bg-card border border-line p-5 mb-6 flex items-center gap-4 flex-wrap">
      <div class="flex-1 min-w-0">
        <p class="text-sm">
          <span class="text-white font-medium">{{ favCount }}</span>
          <span class="text-muted"> {{ $t('recs.favorites') }}</span>
          <span v-if="!canGenerate" class="text-amber-300"> {{ $t('recs.needThree') }}</span>
        </p>
        <p class="text-xs text-muted mt-0.5">{{ $t('recs.feedHint') }}</p>
      </div>
      <BaseButton variant="brand" :disabled="!canGenerate || generating" @click="onGenerate">
        <svg v-if="!generating" viewBox="0 0 24 24" class="w-4 h-4" fill="currentColor"><path d="M12 2l2.4 7.4H22l-6 4.4 2.3 7.2L12 16.6 5.7 21l2.3-7.2-6-4.4h7.6z"/></svg>
        {{ generating ? $t('common.generating') : $t('recs.generate') }}
      </BaseButton>
    </div>

    <p v-if="error" class="text-sm text-amber-300 mb-4">{{ error }}</p>

    <div v-if="recStore.isActive">
      <h2 class="font-display text-lg font-bold mb-3">{{ $t('recs.count', recStore.queue.length) }}</h2>
      <ul class="flex flex-col">
        <TrackItem
          v-for="(track, i) in recStore.queue" :key="track.id"
          :track="track" mode="recommendations" :index="i"
          :is-active="isActive(i)"
          :is-playing="isActive(i) && player.isPlaying"
          @play="playback.playRecIndex(i)"
        />
      </ul>
    </div>
    <div v-else-if="!generating" class="rounded-2xl border border-dashed border-line p-10 text-center text-muted text-sm">
      {{ $t('recs.empty') }}
    </div>
  </div>
</template>
