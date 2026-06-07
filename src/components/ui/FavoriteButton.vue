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
    <!-- Corazón estándar (Material): punta inferior limpia, sin tocar bordes.
         overflow-visible como seguro adicional contra recortes. -->
    <svg
      viewBox="0 0 24 24" class="overflow-visible block"
      :style="{ width: size + 'px', height: size + 'px' }"
      :fill="isFav ? 'currentColor' : 'none'"
      stroke="currentColor" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"
    >
      <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/>
    </svg>
  </button>
</template>
