<script setup lang="ts">
import { computed } from 'vue'
import { RouterLink } from 'vue-router'
import type { Track } from '@/types/track.types'
import type { QueueMode } from '@/types/queue.types'
import { useUiStore } from '@/stores/ui.store'
import TrackCover from '@/components/ui/TrackCover.vue'
import FavoriteButton from '@/components/ui/FavoriteButton.vue'

const props = withDefaults(defineProps<{
  track:     Track
  mode:      QueueMode
  isActive?: boolean
  isPlaying?: boolean
  index?:    number
  removable?: boolean
}>(), { isActive: false, isPlaying: false, removable: false })

const emit = defineEmits<{ play: []; remove: [] }>()

const ui = useUiStore()

const artistLabel = computed(() => props.track.artistDisplay ?? props.track.artist)
const titleLabel  = computed(() => props.track.titleDisplay  ?? props.track.title)

function fmtDuration(ms?: number): string {
  if (!ms) return ''
  const total = Math.round(ms / 1000)
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${m}:${String(s).padStart(2, '0')}`
}
</script>

<template>
  <div
    class="group flex items-center gap-3 px-3 py-2 rounded-xl transition-colors cursor-pointer"
    :class="isActive ? 'bg-brand/15 ring-1 ring-brand/40' : 'hover:bg-card-hover'"
    @dblclick="emit('play')"
  >
    <!-- Índice / botón play -->
    <div class="w-6 shrink-0 grid place-items-center text-sm text-muted tabular-nums">
      <span v-if="isActive && isPlaying" class="text-brand">
        <svg viewBox="0 0 24 24" class="w-4 h-4" fill="currentColor"><rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/></svg>
      </span>
      <template v-else>
        <span class="group-hover:hidden">{{ (index ?? 0) + 1 }}</span>
        <button
          class="hidden group-hover:grid place-items-center text-white"
          aria-label="Reproducir" @click.stop="emit('play')"
        >
          <svg viewBox="0 0 24 24" class="w-4 h-4" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
        </button>
      </template>
    </div>

    <!-- Carátula o skeleton -->
    <TrackCover v-if="track.enriched || track.coverUrl" :src="track.coverUrl" :alt="track.album" :size="44" />
    <div v-else class="w-11 h-11 rounded-lg bg-surface-2 animate-pulse shrink-0" />

    <!-- Título + artista -->
    <div class="min-w-0 flex-1" @click="emit('play')">
      <div class="flex items-center gap-2">
        <p class="text-sm font-medium text-white truncate">{{ titleLabel }}</p>
        <span v-if="track.enrichError" title="No se pudo enriquecer" class="text-amber-400 text-xs">⚠</span>
      </div>
      <template v-if="track.enriched || track.artist">
        <RouterLink
          :to="{ name: 'artist', params: { name: artistLabel } }"
          class="text-xs text-muted truncate hover:text-white/80 hover:underline"
          @click.stop
        >{{ artistLabel }}</RouterLink>
      </template>
      <div v-else class="h-3 w-24 mt-1 rounded bg-surface-2 animate-pulse" />
    </div>

    <!-- Tags (solo desktop) -->
    <div v-if="track.tags?.length" class="hidden lg:flex gap-1 mr-2">
      <span v-for="t in track.tags.slice(0, 2)" :key="t"
            class="text-[10px] px-2 py-0.5 rounded-full bg-surface-2 text-muted">{{ t }}</span>
    </div>

    <!-- Duración -->
    <span class="text-xs text-muted tabular-nums w-10 text-right hidden sm:block">
      {{ fmtDuration(track.duration) }}
    </span>

    <!-- Acciones -->
    <div class="flex items-center gap-1 shrink-0">
      <FavoriteButton :track="track" reveal-on-hover />

      <button
        v-if="mode !== 'playlist'"
        class="p-1.5 rounded-lg text-muted hover:bg-white/10 opacity-0 group-hover:opacity-100 transition"
        aria-label="Guardar en playlist"
        @click.stop="ui.openSaveToPlaylist(track)"
      >
        <svg viewBox="0 0 24 24" class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 5v14M5 12h14"/></svg>
      </button>

      <button
        v-if="removable"
        class="p-1.5 rounded-lg text-muted hover:bg-red-500/15 hover:text-red-400 opacity-0 group-hover:opacity-100 transition"
        aria-label="Quitar de la playlist"
        @click.stop="emit('remove')"
      >
        <svg viewBox="0 0 24 24" class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 12h14"/></svg>
      </button>
    </div>
  </div>
</template>
