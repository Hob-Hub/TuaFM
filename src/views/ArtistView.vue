<script setup lang="ts">
import { watch, computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useArtist } from '@/composables/useArtist'
import { usePlayback } from '@/composables/usePlayback'
import { nanoid } from 'nanoid'
import TrackCover from '@/components/ui/TrackCover.vue'
import BaseButton from '@/components/ui/BaseButton.vue'

const route = useRoute()
const router = useRouter()
const { info, loading, error, load } = useArtist()
const playback = usePlayback()

const artistName = computed(() => String(route.params.name))

watch(artistName, (name) => { if (name) load(name) }, { immediate: true })

function fmtListeners(n: number): string {
  return new Intl.NumberFormat('es-ES').format(n)
}

// Reproduce un top track creando una mini-cola de playlist efímera
function playTrack(track: { title: string; coverUrl?: string }): void {
  if (!info.value) return
  playback.startPlaylistQueue(
    [{ id: nanoid(), artist: info.value.name, title: track.title, coverUrl: track.coverUrl, enriched: false }],
    0, null
  )
}
</script>

<template>
  <div class="p-5 sm:p-8 max-w-3xl mx-auto">
    <button class="text-sm text-muted hover:text-white mb-5 flex items-center gap-1" @click="router.back()">
      <svg viewBox="0 0 24 24" class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2"><path d="M15 18l-6-6 6-6"/></svg>
      Volver
    </button>

    <div v-if="loading" class="animate-pulse space-y-4">
      <div class="flex gap-5">
        <div class="w-40 h-40 rounded-2xl bg-surface-2" />
        <div class="flex-1 space-y-3 pt-4">
          <div class="h-8 w-1/2 bg-surface-2 rounded" />
          <div class="h-4 w-1/3 bg-surface-2 rounded" />
        </div>
      </div>
    </div>

    <p v-else-if="error" class="text-amber-300 text-sm">{{ error }}</p>

    <template v-else-if="info">
      <header class="flex items-end gap-4 sm:gap-5 mb-6">
        <TrackCover :src="info.imageUrl" :fallback-text="info.name" :size="160" rounded="rounded-2xl"
                    class="w-28! h-28! sm:w-40! sm:h-40! shrink-0" />
        <div class="min-w-0 flex-1 pb-1">
          <p class="text-xs uppercase tracking-wider text-muted">Artista</p>
          <h1 class="font-display text-3xl sm:text-4xl font-extrabold truncate">{{ info.name }}</h1>
          <p class="text-sm text-muted mt-2">{{ fmtListeners(info.listeners) }} oyentes en Last.fm</p>
          <div v-if="info.tags.length" class="flex flex-wrap gap-1.5 mt-3">
            <span v-for="t in info.tags" :key="t" class="text-[11px] px-2 py-0.5 rounded-full bg-surface-2 text-muted">{{ t }}</span>
          </div>
        </div>
      </header>

      <p v-if="info.bio" class="text-sm text-white/70 leading-relaxed mb-8 line-clamp-5">{{ info.bio }}</p>

      <section v-if="info.topTracks.length">
        <h2 class="font-display text-lg font-bold mb-3">Canciones populares</h2>
        <ul class="flex flex-col">
          <li v-for="(t, i) in info.topTracks" :key="t.title"
              class="group flex items-center gap-3 px-3 py-2 rounded-xl hover:bg-card-hover cursor-pointer"
              @click="playTrack(t)">
            <span class="w-5 text-sm text-muted tabular-nums shrink-0">{{ i + 1 }}</span>
            <TrackCover :src="t.coverUrl" :alt="t.title" :fallback-text="t.title" :size="40" />
            <span class="flex-1 text-sm text-white truncate">{{ t.title }}</span>
            <span class="text-xs text-muted tabular-nums hidden sm:block">{{ fmtListeners(t.listeners) }}</span>
            <BaseButton size="sm" variant="ghost" class="opacity-0 group-hover:opacity-100" @click.stop="playTrack(t)">
              <svg viewBox="0 0 24 24" class="w-4 h-4" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
            </BaseButton>
          </li>
        </ul>
      </section>
    </template>
  </div>
</template>
