<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { makeTrack } from '@/utils/track'
import { useChartRegistryStore } from '@/stores/chartRegistry.store'
import { usePlayback } from '@/composables/usePlayback'
import { usePlayerStore } from '@/stores/player.store'
import { useUiStore } from '@/stores/ui.store'
import { getYearTop } from '@/services/radio.service'
import { chartCountryName } from '@/utils/chartLabels'
import { useI18n } from 'vue-i18n'
import type { Track } from '@/types/track.types'
import TrackItem from '@/components/playlist/TrackItem.vue'
import BaseButton from '@/components/ui/BaseButton.vue'

const route = useRoute()
const router = useRouter()
const registry = useChartRegistryStore()
const playback = usePlayback()
const player = usePlayerStore()
const ui = useUiStore()
const { t } = useI18n()

const chartId = computed(() => String(route.params.chartId))
const year    = computed(() => Number(route.params.year))

const tracks  = ref<Track[]>([])
const loading = ref(false)

const reg = computed(() => registry.getById(chartId.value))

async function load(): Promise<void> {
  loading.value = true
  tracks.value = []
  try {
    await registry.load()
    const top = await getYearTop(chartId.value, year.value)
    tracks.value = (top?.songs ?? []).map(s => makeTrack({
      artist: s.artist, title: s.title,
      artistDisplay: s.artistDisplay, titleDisplay: s.titleDisplay,
      youtubeVideoId: s.youtubeVideoId, coverUrl: s.coverUrl,
      chartYear: s.chartYear, duration: s.duration,
      language: s.language,
      languageConfidence: s.languageConfidence,
      languageSource: s.languageSource
    }))
  } finally {
    loading.value = false
  }
}
watch([chartId, year], load, { immediate: true })

// Reproduce desde la pista i, encolando el Top entero como lista efímera.
function play(i: number): void {
  playback.startPlaylistQueue([...tracks.value], i, null)
}
function playAll(): void {
  if (tracks.value.length) play(0)
}
function isActiveRow(i: number): boolean {
  return player.queueMode === 'playlist' && player.currentTrackId === tracks.value[i]?.id
}
function saveAll(): void {
  if (tracks.value.length) ui.openSaveTracksToPlaylist([...tracks.value], t('chart.top', { year: year.value }))
}
</script>

<template>
  <div class="p-5 sm:p-8 max-w-3xl mx-auto">
    <button class="text-sm text-muted hover:text-white mb-5 flex items-center gap-1" @click="router.back()">
      <svg viewBox="0 0 24 24" class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2"><path d="M15 18l-6-6 6-6"/></svg>
      {{ $t('common.back') }}
    </button>

    <header class="flex items-end justify-between gap-4 mb-6 flex-wrap">
      <div class="min-w-0">
        <p class="text-xs uppercase tracking-wider text-muted">{{ reg?.flag }} {{ chartCountryName(reg?.country, reg?.name ?? $t('chart.listFallback')) }}</p>
        <h1 class="font-display text-3xl sm:text-4xl font-extrabold">{{ $t('chart.top', { year }) }}</h1>
        <p class="text-sm text-muted mt-1">{{ $t('common.songs', tracks.length) }} · {{ $t('chart.realTop') }}</p>
      </div>
      <div class="flex items-center gap-2">
        <BaseButton variant="surface" :disabled="!tracks.length" :aria-label="$t('common.saveAll')" @click="saveAll">
          <svg viewBox="0 0 24 24" class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>
          {{ $t('common.saveAll') }}
        </BaseButton>
        <BaseButton variant="brand" size="lg" :disabled="!tracks.length" @click="playAll">
          <svg viewBox="0 0 24 24" class="w-5 h-5" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
          {{ $t('common.play') }}
        </BaseButton>
      </div>
    </header>

    <div v-if="loading" class="rounded-2xl border border-dashed border-line p-10 text-center text-muted text-sm">
      {{ $t('chart.loading', { year }) }}
    </div>
    <div v-else-if="!tracks.length" class="rounded-2xl border border-dashed border-line p-10 text-center text-muted text-sm">
      {{ $t('chart.noData') }}
    </div>
    <ul v-else class="flex flex-col">
      <TrackItem
        v-for="(track, i) in tracks" :key="track.id"
        :track="track" mode="playlist" :index="i"
        :is-active="isActiveRow(i)"
        :is-playing="isActiveRow(i) && player.isPlaying"
        @play="play(i)"
      />
    </ul>
  </div>
</template>
