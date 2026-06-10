<script setup lang="ts">
import { ref, computed, watch } from 'vue'

const props = withDefaults(defineProps<{
  src?:  string
  alt?:  string
  size?: number
  rounded?: string
  fallbackText?: string   // si se indica, el placeholder muestra inicial + degradado
}>(), { size: 48, rounded: 'rounded-lg' })

const failed = ref(false)
watch(() => props.src, () => { failed.value = false })

// Hosts cuyas imágenes el navegador bloquea por ORB (Opaque Response Blocking):
// responden sin content-type/CORS válidos, así que el <img> nunca pinta y deja
// un hueco hasta que (a veces tarde) salta el onerror. Los descartamos de
// entrada para ir directos al placeholder, sin parpadeo de imagen rota. El
// catálogo trae ~450 carátulas de prisaradio así; el arreglo de fondo es
// resolverlas al regenerar el catálogo (chart-pipeline).
const BLOCKED_COVER_HOSTS = ['recursosweb.prisaradio.com']
const usableSrc = computed(() =>
  props.src && !BLOCKED_COVER_HOSTS.some(h => props.src!.includes(h)) ? props.src : undefined
)

// Degradado determinista a partir del texto (mismo nombre → mismo color).
const gradient = computed(() => {
  const t = props.fallbackText ?? ''
  let h = 0
  for (let i = 0; i < t.length; i++) h = (h * 31 + t.charCodeAt(i)) % 360
  return `linear-gradient(135deg, hsl(${h} 55% 38%), hsl(${(h + 40) % 360} 55% 22%))`
})

const initial = computed(() => (props.fallbackText?.trim()?.[0] ?? '').toUpperCase())
</script>

<template>
  <div
    class="relative shrink-0 overflow-hidden bg-surface-2 grid place-items-center"
    :class="rounded"
    :style="{ width: size + 'px', height: size + 'px' }"
  >
    <img
      v-if="usableSrc && !failed"
      :src="usableSrc"
      :alt="alt ?? ''"
      loading="lazy"
      class="w-full h-full object-cover"
      @error="failed = true"
    />
    <!-- Placeholder con inicial (artistas) -->
    <div
      v-else-if="fallbackText && initial"
      class="w-full h-full grid place-items-center font-display font-bold text-white/90 select-none"
      :style="{ background: gradient, fontSize: size * 0.42 + 'px' }"
    >{{ initial }}</div>
    <!-- Placeholder genérico (nota musical) -->
    <svg v-else viewBox="0 0 24 24" class="w-1/2 h-1/2 text-muted/50" fill="currentColor" aria-hidden="true">
      <path d="M12 3v10.55A4 4 0 1 0 14 17V7h4V3h-6z" />
    </svg>
  </div>
</template>
