<script setup lang="ts">
import { watch, computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute, useRouter } from 'vue-router'
import { useArtist } from '@/composables/useArtist'
import { usePlayback } from '@/composables/usePlayback'
import { makeTrack } from '@/utils/track'
import TrackCover from '@/components/ui/TrackCover.vue'
import BaseButton from '@/components/ui/BaseButton.vue'

const INITIAL_VISIBLE = 15

const route = useRoute()
const router = useRouter()
const { n } = useI18n()
const { info, loading, loadingMore, error, load, loadMore } = useArtist()
const playback = usePlayback()

const artistName = computed(() => String(route.params.name))

const visibleCount  = ref(INITIAL_VISIBLE)
const visibleTracks = computed(() => info.value?.topTracks.slice(0, visibleCount.value) ?? [])
// Hay más que mostrar si quedan filas cargadas ocultas o si aún no tenemos el top completo.
const canShowMore   = computed(() =>
  !!info.value && (visibleCount.value < info.value.topTracks.length || !info.value.topTracksComplete)
)

watch(artistName, (name) => { visibleCount.value = INITIAL_VISIBLE; if (name) load(name) }, { immediate: true })

// "Mostrar más": primero revela las filas ya cargadas; si no quedan y el top no
// está completo, pide el resto (loadMore() → Last.fm una vez + Dexie) y lo revela.
async function showMore(): Promise<void> {
  if (!info.value) return
  if (visibleCount.value < info.value.topTracks.length) {
    visibleCount.value = info.value.topTracks.length
  } else if (!info.value.topTracksComplete) {
    await loadMore()
    visibleCount.value = info.value.topTracks.length
  }
}

function fmtListeners(value: number): string {
  return n(value, 'decimal')
}

// Reproduce desde la canción pulsada y encadena el resto de las populares del
// artista en una cola de playlist (no una sola pista): así suenan una tras otra.
function playTrack(index: number): void {
  if (!info.value) return
  const queue = info.value.topTracks.map(t =>
    makeTrack({ artist: info.value!.name, title: t.title, coverUrl: t.coverUrl })
  )
  playback.startPlaylistQueue(queue, index, null)
}
</script>

<template>
  <div class="p-5 sm:p-8 max-w-3xl mx-auto">
    <button class="text-sm text-muted hover:text-white mb-5 flex items-center gap-1" @click="router.back()">
      <svg viewBox="0 0 24 24" class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2"><path d="M15 18l-6-6 6-6"/></svg>
      {{ $t('common.back') }}
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
          <p class="text-xs uppercase tracking-wider text-muted">{{ $t('artist.label') }}</p>
          <h1 class="font-display text-3xl sm:text-4xl font-extrabold truncate">{{ info.name }}</h1>
          <p class="text-sm text-muted mt-2">{{ $t('artist.listeners', { count: fmtListeners(info.listeners) }, { plural: info.listeners }) }}</p>
          <div v-if="info.tags.length" class="flex flex-wrap gap-1.5 mt-3">
            <span v-for="t in info.tags" :key="t" class="text-[11px] px-2 py-0.5 rounded-full bg-surface-2 text-muted">{{ t }}</span>
          </div>
        </div>
      </header>

      <p v-if="info.bio" class="text-sm text-white/70 leading-relaxed mb-8 line-clamp-5">{{ info.bio }}</p>

      <section v-if="info.topTracks.length">
        <h2 class="font-display text-lg font-bold mb-3">{{ $t('artist.popularTracks') }}</h2>
        <ul class="flex flex-col">
          <li v-for="(t, i) in visibleTracks" :key="t.title"
              class="group flex items-center gap-3 px-3 py-2 rounded-xl hover:bg-card-hover cursor-pointer"
              @click="playTrack(i)">
            <span class="w-5 text-sm text-muted tabular-nums shrink-0">{{ i + 1 }}</span>
            <TrackCover :src="t.coverUrl" :alt="t.title" :fallback-text="t.title" :size="40" />
            <span class="flex-1 text-sm text-white truncate">{{ t.title }}</span>
            <span class="text-xs text-muted tabular-nums hidden sm:block">{{ fmtListeners(t.listeners) }}</span>
            <BaseButton size="sm" variant="ghost" class="opacity-0 group-hover:opacity-100" @click.stop="playTrack(i)">
              <svg viewBox="0 0 24 24" class="w-4 h-4" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
            </BaseButton>
          </li>
        </ul>

        <div v-if="canShowMore" class="mt-4 flex justify-center">
          <BaseButton variant="ghost" :disabled="loadingMore" @click="showMore">
            {{ loadingMore ? $t('common.loading') : $t('common.showMore') }}
          </BaseButton>
        </div>
      </section>

      <!-- Artistas similares: navegación entre fichas (catálogo offline o Last.fm) -->
      <section v-if="info.similar.length" class="mt-8">
        <h2 class="font-display text-lg font-bold mb-3">{{ $t('artist.similar') }}</h2>
        <div class="flex flex-wrap gap-2">
          <RouterLink
            v-for="name in info.similar" :key="name"
            :to="{ name: 'artist', params: { name } }"
            class="px-3 py-1.5 rounded-full bg-surface-2 border border-line text-sm text-white/90 hover:bg-card-hover hover:border-brand/50 transition-colors"
          >{{ name }}</RouterLink>
        </div>
      </section>
    </template>
  </div>
</template>
