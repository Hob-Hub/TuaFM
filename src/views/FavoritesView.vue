<script setup lang="ts">
import { computed } from 'vue'
import { RouterLink } from 'vue-router'
import { nanoid } from 'nanoid'
import { useFavorites } from '@/composables/useFavorites'
import { usePlayback } from '@/composables/usePlayback'
import { usePlayerStore } from '@/stores/player.store'
import TrackItem from '@/components/playlist/TrackItem.vue'
import BaseButton from '@/components/ui/BaseButton.vue'
import type { Track } from '@/types/track.types'

const { favorites } = useFavorites()
const playback = usePlayback()
const player = usePlayerStore()

// Los favoritos se guardan ligeros (cacheKey/artista/título/carátula); se hidratan
// a Track efímero y el flujo normal de reproducción los enriquece bajo demanda.
const tracks = computed<Track[]>(() =>
  favorites.value.map((f) => ({
    id: nanoid(),
    artist: f.artist,
    title: f.title,
    coverUrl: f.coverUrl,
    enriched: false,
  })),
)

function isActive(i: number): boolean {
  return player.queueMode === 'playlist' && player.currentTrackId === tracks.value[i]?.id
}

function play(i: number): void {
  playback.startPlaylistQueue(tracks.value, i, null)
}
</script>

<template>
  <div class="p-5 sm:p-8 max-w-3xl mx-auto">
    <header class="mb-6 flex items-end justify-between gap-4 flex-wrap">
      <div>
        <h1 class="font-display text-2xl sm:text-3xl font-extrabold">{{ $t('favorites.title') }}</h1>
        <p class="text-muted text-sm mt-1">{{ $t('favorites.subtitle') }}</p>
      </div>
      <BaseButton v-if="tracks.length" variant="brand" @click="play(0)">
        <svg viewBox="0 0 24 24" class="w-4 h-4" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
        {{ $t('common.play') }}
      </BaseButton>
    </header>

    <div v-if="tracks.length">
      <p class="text-xs text-muted mb-3">{{ $t('favorites.count', tracks.length) }}</p>
      <ul class="flex flex-col">
        <TrackItem
          v-for="(track, i) in tracks" :key="track.id"
          :track="track" mode="playlist" :index="i"
          :is-active="isActive(i)"
          :is-playing="isActive(i) && player.isPlaying"
          @play="play(i)"
        />
      </ul>
    </div>
    <div v-else class="rounded-2xl border border-dashed border-line p-10 text-center text-muted text-sm">
      {{ $t('favorites.empty') }}
      <RouterLink :to="{ name: 'search' }" class="block mx-auto mt-3 text-brand font-medium hover:underline">
        {{ $t('favorites.emptyHint') }}
      </RouterLink>
    </div>
  </div>
</template>
