<script setup lang="ts">
import { ref, watch } from 'vue'
import { RouterLink, useRoute, useRouter } from 'vue-router'
import { useDebounceFn } from '@vueuse/core'
import { nanoid } from 'nanoid'
import {
  searchArtists, searchTrack, getTrackCover,
  type ArtistSearchResult, type TrackSearchResult
} from '@/services/lastfm.service'
import { usePlayback } from '@/composables/usePlayback'
import TrackCover from '@/components/ui/TrackCover.vue'

const route    = useRoute()
const router   = useRouter()
const playback = usePlayback()

const q       = ref(String(route.query.q ?? ''))
const artists = ref<ArtistSearchResult[]>([])
const songs   = ref<TrackSearchResult[]>([])
const loading = ref(false)
const searched = ref(false)

function fmtListeners(n: number): string {
  return n > 0 ? `${new Intl.NumberFormat('es-ES').format(n)} oyentes` : ''
}

async function runSearch(query: string): Promise<void> {
  const term = query.trim()
  if (term.length < 2) {
    artists.value = []; songs.value = []; searched.value = false
    return
  }
  loading.value  = true
  searched.value = true
  const [aRes, sRes] = await Promise.allSettled([
    searchArtists(term, 12),
    searchTrack(term, 24)
  ])
  artists.value = aRes.status === 'fulfilled' ? aRes.value : []
  songs.value   = sRes.status === 'fulfilled' ? sRes.value : []
  loading.value = false
  void resolveSongCovers(songs.value)
}

// Carátulas reales en segundo plano para las canciones sin imagen (sin YouTube).
async function resolveSongCovers(list: TrackSearchResult[]): Promise<void> {
  const CONCURRENCY = 5
  let i = 0
  async function worker(): Promise<void> {
    while (i < list.length) {
      const s = list[i++]
      if (s.coverUrl) continue
      const cover = await getTrackCover(s.artist, s.title).catch(() => undefined)
      if (cover) s.coverUrl = cover
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker))
}

const debouncedSearch = useDebounceFn((query: string) => { void runSearch(query) }, 350)

// q dirige la búsqueda y se refleja en la URL (?q=) para poder compartir/volver.
watch(q, (val) => {
  router.replace({ name: 'search', query: val ? { q: val } : {} })
  debouncedSearch(val)
})

// Navegación externa al buscador (p. ej. desde el sidebar) sincroniza el input.
watch(() => route.query.q, (val) => {
  const s = String(val ?? '')
  if (s !== q.value) q.value = s
})

function playSong(s: TrackSearchResult): void {
  playback.startPlaylistQueue(
    [{ id: nanoid(), artist: s.artist, title: s.title, coverUrl: s.coverUrl, enriched: false }],
    0, null
  )
}

// Búsqueda inicial si se llega con ?q= en la URL.
if (q.value) void runSearch(q.value)
</script>

<template>
  <div class="p-5 sm:p-8 max-w-5xl mx-auto space-y-8">
    <!-- Caja de búsqueda -->
    <div class="relative">
      <svg viewBox="0 0 24 24" class="w-5 h-5 absolute left-3.5 top-1/2 -translate-y-1/2 text-muted" fill="none" stroke="currentColor" stroke-width="2">
        <circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/>
      </svg>
      <input
        v-model="q"
        type="search"
        autofocus
        placeholder="Busca artistas o canciones…"
        aria-label="Buscar artistas o canciones"
        class="w-full h-12 pl-11 pr-4 rounded-2xl bg-surface-2 border border-line text-white/90 text-base
               placeholder:text-muted/60 focus:outline-none focus:border-brand/70 focus:ring-2 focus:ring-brand/30 transition-colors"
      />
    </div>

    <!-- Estados -->
    <p v-if="loading" class="text-sm text-muted">Buscando…</p>
    <p v-else-if="searched && !artists.length && !songs.length" class="text-sm text-muted">
      Sin resultados para «{{ q }}».
    </p>
    <p v-else-if="!searched" class="text-sm text-muted">
      Escribe al menos 2 letras para buscar.
    </p>

    <!-- Artistas -->
    <section v-if="artists.length">
      <h2 class="font-display text-lg font-bold mb-3">Artistas</h2>
      <div class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
        <RouterLink
          v-for="a in artists" :key="a.name"
          :to="{ name: 'artist', params: { name: a.name } }"
          class="group p-3 rounded-2xl bg-card hover:bg-card-hover transition-colors flex flex-col items-center text-center"
        >
          <TrackCover :src="a.imageUrl" :fallback-text="a.name" :size="120" rounded="rounded-full" />
          <p class="mt-3 text-sm font-medium text-white truncate w-full">{{ a.name }}</p>
          <p class="text-xs text-muted truncate w-full">{{ fmtListeners(a.listeners) }}</p>
        </RouterLink>
      </div>
    </section>

    <!-- Canciones -->
    <section v-if="songs.length">
      <h2 class="font-display text-lg font-bold mb-3">Canciones</h2>
      <ul class="flex flex-col">
        <li
          v-for="(s, i) in songs" :key="`${s.artist}-${s.title}-${i}`"
          class="group flex items-center gap-3 px-3 py-2 rounded-xl hover:bg-card-hover cursor-pointer"
          @click="playSong(s)"
        >
          <TrackCover :src="s.coverUrl" :alt="s.title" :size="44" />
          <div class="min-w-0 flex-1">
            <p class="text-sm font-medium text-white truncate">{{ s.title }}</p>
            <RouterLink
              :to="{ name: 'artist', params: { name: s.artist } }"
              class="text-xs text-muted truncate hover:text-white/80 hover:underline"
              @click.stop
            >{{ s.artist }}</RouterLink>
          </div>
          <button
            class="p-2 rounded-lg text-muted hover:bg-white/10 hover:text-white opacity-0 group-hover:opacity-100 transition shrink-0"
            aria-label="Reproducir" @click.stop="playSong(s)"
          >
            <svg viewBox="0 0 24 24" class="w-4 h-4" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
          </button>
        </li>
      </ul>
    </section>
  </div>
</template>
