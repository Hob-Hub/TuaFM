<script setup lang="ts">
import { computed, ref, onMounted } from 'vue'
import { RouterLink, useRouter } from 'vue-router'
import { makeTrack } from '@/utils/track'
import { usePlayHistory } from '@/composables/usePlayHistory'
import { usePlayback } from '@/composables/usePlayback'
import { useRadioQueue } from '@/composables/useRadioQueue'
import { chartCountryName } from '@/utils/chartLabels'
import { getDiscoveryTracks } from '@/services/catalog/static.source'
import { useRecentRadiosStore, type RecentRadio } from '@/stores/recentRadios.store'
import PlaylistList from '@/components/playlist/PlaylistList.vue'
import TrackCover from '@/components/ui/TrackCover.vue'
import type { PlayHistoryEntry } from '@/types/playlist.types'
import type { Track } from '@/types/track.types'

const { history } = usePlayHistory()
const playback = usePlayback()
const router = useRouter()
const recentRadios = useRecentRadiosStore()
const { generate } = useRadioQueue()

// Descubre: muestra notable del catálogo (offline, coste cero), barajada en cada
// carga y reproducible como lista efímera.
const discovery = ref<Track[]>([])
onMounted(async () => {
  const tracks = await getDiscoveryTracks(12)
  discovery.value = tracks.map(t => makeTrack({
    artist: t.artist, title: t.title,
    coverUrl: t.coverUrl, youtubeVideoId: t.youtubeVideoId,
    chartYear: t.chartYear, duration: t.durationMs,
    language: t.language,
    languageConfidence: t.languageConfidence,
    languageSource: t.languageSource
  }))
})
function playDiscovery(i: number): void {
  playback.startPlaylistQueue([...discovery.value], i, null)
}

// Volver a escuchar una radio: regenera con los mismos ajustes y la reproduce.
async function playRadio(r: RecentRadio): Promise<void> {
  const ok = await generate({ chartId: r.chartId, refYear: r.year, lambda: r.lambda })
  if (ok) { playback.playRadioIndex(0); router.push({ name: 'radio' }) }
}

// label/desc se localizan en plantilla con las claves home.*.
const shortcuts = [
  { name: 'radio', labelKey: 'home.radioCard', descKey: 'home.radioCardDesc', to: { name: 'radio' },
    cls: 'from-brand/40 to-surface-2', icon: 'M4 8h16v11H4zM8 4l8 3' },
  { name: 'recs', labelKey: 'home.recsCard', descKey: 'home.recsCardDesc', to: { name: 'recs' },
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
  playback.playSingle(makeTrack({ artist: e.artist, title: e.title, coverUrl: e.coverUrl }))
}
</script>

<template>
  <div class="p-5 sm:p-8 max-w-6xl mx-auto space-y-8">
    <header>
      <h1 class="font-display text-2xl sm:text-3xl font-extrabold">{{ $t('home.title') }}</h1>
      <p class="text-muted text-sm mt-1">{{ $t('home.subtitle') }}</p>
    </header>

    <div class="grid sm:grid-cols-2 gap-3">
      <RouterLink
        v-for="s in shortcuts" :key="s.name" :to="s.to"
        class="group relative overflow-hidden rounded-2xl border border-line p-5 bg-gradient-to-br transition-transform hover:scale-[1.01]"
        :class="s.cls"
      >
        <svg viewBox="0 0 24 24" class="w-8 h-8 text-white/90 mb-8" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path :d="s.icon"/></svg>
        <p class="font-display text-xl font-bold">{{ $t(s.labelKey) }}</p>
        <p class="text-sm text-white/70">{{ $t(s.descKey) }}</p>
      </RouterLink>
    </div>

    <!-- Tus radios recientes: volver a escuchar con un clic -->
    <section v-if="recentRadios.items.length">
      <h2 class="font-display text-lg font-bold mb-4">{{ $t('home.recentRadios') }}</h2>
      <div class="flex gap-3 overflow-x-auto pb-2 -mx-1 px-1 snap-x">
        <button
          v-for="r in recentRadios.items" :key="`${r.chartId}-${r.year}`"
          class="group relative w-44 shrink-0 snap-start text-left rounded-2xl border border-line p-4
                 bg-gradient-to-br from-brand/25 to-surface-2 hover:from-brand/35 transition-colors"
          @click="playRadio(r)"
        >
          <div class="flex items-center justify-between">
            <span class="text-2xl leading-none">{{ r.flag }}</span>
            <span class="grid place-items-center w-8 h-8 rounded-full bg-brand text-white shadow-lg
                         opacity-0 group-hover:opacity-100 transition">
              <svg viewBox="0 0 24 24" class="w-4 h-4 ml-0.5" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
            </span>
          </div>
          <p class="font-display text-2xl font-extrabold tabular-nums mt-3">{{ r.year }}</p>
          <p class="text-sm text-white/90 truncate">{{ chartCountryName(r.country, r.name) }}</p>
          <p class="text-[11px] text-muted/80 mt-1 tabular-nums">{{ $t('home.nostalgia', { value: r.lambda.toFixed(2) }) }}</p>
        </button>
      </div>
    </section>

    <!-- Reproducido recientemente -->
    <section v-if="recent.length">
      <h2 class="font-display text-lg font-bold mb-4">{{ $t('home.recentlyPlayed') }}</h2>
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

    <!-- Descubre: muestra notable del catálogo (offline) -->
    <section v-if="discovery.length">
      <h2 class="font-display text-lg font-bold mb-4">{{ $t('home.discover') }}</h2>
      <div class="flex gap-3 overflow-x-auto pb-2 -mx-1 px-1 snap-x">
        <button
          v-for="(track, i) in discovery" :key="track.id"
          class="group w-36 shrink-0 snap-start text-left rounded-2xl bg-card hover:bg-card-hover border border-line p-3 transition-colors"
          @click="playDiscovery(i)"
        >
          <div class="relative mb-3">
            <TrackCover :src="track.coverUrl" :fallback-text="track.title" :size="120" rounded="rounded-xl" class="w-full! h-auto! aspect-square" />
            <span class="absolute bottom-2 right-2 grid place-items-center w-9 h-9 rounded-full bg-brand text-white shadow-lg
                         opacity-0 translate-y-1 group-hover:opacity-100 group-hover:translate-y-0 transition">
              <svg viewBox="0 0 24 24" class="w-4 h-4 ml-0.5" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
            </span>
          </div>
          <p class="text-sm font-medium text-white truncate">{{ track.title }}</p>
          <p class="text-xs text-muted truncate">{{ track.artist }}</p>
        </button>
      </div>
    </section>

    <PlaylistList />
  </div>
</template>
