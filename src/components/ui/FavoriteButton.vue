<script setup lang="ts">
import { computed } from 'vue'
import type { Track } from '@/types/track.types'
import { makeCacheKey } from '@/db/local.db'
import { useFavorites } from '@/composables/useFavorites'

const props = withDefaults(defineProps<{
  track: Track | null
  size?: number
  revealOnHover?: boolean   // oculto hasta hover del grupo (filas de lista)
}>(), { size: 16, revealOnHover: false })

const { favorites, toggleFavorite } = useFavorites()

const isFav = computed(() => {
  if (!props.track) return false
  const key = makeCacheKey(props.track.artist, props.track.title)
  return favorites.value.some(f => f.cacheKey === key)
})

function toggle(e: Event): void {
  e.stopPropagation()
  if (props.track) toggleFavorite(props.track)
}
</script>

<template>
  <button
    type="button"
    class="p-1.5 rounded-lg hover:bg-white/10 transition-colors shrink-0 grid place-items-center"
    :class="isFav ? 'text-brand' : revealOnHover ? 'text-muted opacity-0 group-hover:opacity-100' : 'text-muted'"
    :aria-label="isFav ? 'Quitar de favoritos' : 'Añadir a favoritos'"
    :aria-pressed="isFav"
    @click="toggle"
  >
    <!-- viewBox holgado + overflow-visible: el trazo del corazón nunca se recorta. -->
    <svg
      viewBox="-3 -3 30 30" class="overflow-visible block"
      :style="{ width: size + 'px', height: size + 'px' }"
      :fill="isFav ? 'currentColor' : 'none'"
      stroke="currentColor" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"
    >
      <path d="M12 21s-7-4.35-9.5-8.5C.5 8.5 2.5 5 6 5c2 0 3.2 1.2 4 2.5C10.8 6.2 12 5 14 5c3.5 0 5.5 3.5 3.5 7.5C19 16.65 12 21 12 21z"/>
    </svg>
  </button>
</template>
