<script setup lang="ts">
import { computed } from 'vue'
import { RouterLink } from 'vue-router'
import { nanoid } from 'nanoid'
import { usePlayHistory } from '@/composables/usePlayHistory'
import { usePlayback } from '@/composables/usePlayback'
import PlaylistList from '@/components/playlist/PlaylistList.vue'
import TrackCover from '@/components/ui/TrackCover.vue'
import type { PlayHistoryEntry } from '@/types/playlist.types'

const { history } = usePlayHistory()
const playback = usePlayback()

const shortcuts = [
  { name: 'radio', label: 'Radio', desc: 'La máquina del tiempo sonora', to: { name: 'radio' },
    cls: 'from-brand/40 to-surface-2', icon: 'M4 8h16v11H4zM8 4l8 3' },
  { name: 'recs', label: 'Recomendaciones', desc: 'El oráculo de Last.fm', to: { name: 'recs' },
    cls: 'from-fuchsia-500/30 to-surface-2', icon: 'M12 2l2.4 7.4H22l-6 4.4 2.3 7.2L12 16.6 5.7 21l2.3-7.2-6-4.4h7.6z' }
]

// Reproducciones recientes, sin duplicar la misma canción.
const recent = computed(() => {
  const seen = new Set<string>()
  const out: PlayHistoryEntry[] = []
  for (const e of history.value) {
    if (seen.has(e.cacheKey)) continue
    seen.add(e.cacheKey)
    out.push(e)
    if (out.length >= 10) break
  }
  return out
})

function playEntry(e: PlayHistoryEntry): void {
  playback.startPlaylistQueue(
    [{ id: nanoid(), artist: e.artist, title: e.title, coverUrl: e.coverUrl, enriched: false }],
    0, null
  )
}
</script>

<template>
  <div class="p-5 sm:p-8 max-w-6xl mx-auto space-y-8">
    <header>
      <h1 class="font-display text-2xl sm:text-3xl font-extrabold">Tu radio imaginaria</h1>
      <p class="text-muted text-sm mt-1">Construida desde los charts reales. Explora, escucha, colecciona.</p>
    </header>

    <div class="grid sm:grid-cols-2 gap-3">
      <RouterLink
        v-for="s in shortcuts" :key="s.name" :to="s.to"
        class="group relative overflow-hidden rounded-2xl border border-line p-5 bg-gradient-to-br transition-transform hover:scale-[1.01]"
        :class="s.cls"
      >
        <svg viewBox="0 0 24 24" class="w-8 h-8 text-white/90 mb-8" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path :d="s.icon"/></svg>
        <p class="font-display text-xl font-bold">{{ s.label }}</p>
        <p class="text-sm text-white/70">{{ s.desc }}</p>
      </RouterLink>
    </div>

    <!-- Reproducido recientemente -->
    <section v-if="recent.length">
      <h2 class="font-display text-lg font-bold mb-4">Reproducido recientemente</h2>
      <div class="flex gap-3 overflow-x-auto pb-2 -mx-1 px-1 snap-x">
        <button
          v-for="e in recent" :key="e.id"
          class="group w-36 shrink-0 snap-start text-left rounded-2xl bg-card hover:bg-card-hover border border-line p-3 transition-colors"
          @click="playEntry(e)"
        >
          <div class="relative mb-3">
            <TrackCover :src="e.coverUrl" :fallback-text="e.title" :size="120" rounded="rounded-xl" class="w-full! h-auto! aspect-square" />
            <span class="absolute bottom-2 right-2 grid place-items-center w-9 h-9 rounded-full bg-brand text-white shadow-lg
                         opacity-0 translate-y-1 group-hover:opacity-100 group-hover:translate-y-0 transition">
              <svg viewBox="0 0 24 24" class="w-4 h-4 ml-0.5" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
            </span>
          </div>
          <p class="text-sm font-medium text-white truncate">{{ e.title }}</p>
          <p class="text-xs text-muted truncate">{{ e.artist }}</p>
        </button>
      </div>
    </section>

    <PlaylistList />
  </div>
</template>
