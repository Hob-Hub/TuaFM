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

// Defensa para URLs antiguas importadas por el usuario o guardadas en cachés
// locales: si el navegador las bloquea por ORB, vamos directos al placeholder.
// El catálogo versionado se normaliza para no traer estos hosts.
const BLOCKED_COVER_HOSTS = ['recursosweb.prisaradio.com']
const usableSrc = computed(() =>
  props.src && !BLOCKED_COVER_HOSTS.some(h => props.src!.includes(h)) ? props.src : undefined
)

// Degradado determinista a partir del texto (mismo nombre → mismo color).
const gradient = computed(() => {
  const t = props.fallbackText ?? ''
  let h = 0
  for (let i = 0; i < t.length; i++) h = (h * 31 + t.charCodeAt(i)) % 360
  return `linear-gradient(135deg, hsl(${h} 45% 34%), hsl(${(h + 40) % 360} 45% 20%))`
})

const initial = computed(() => (props.fallbackText?.trim()?.[0] ?? '').toUpperCase())
</script>

<template>
  <div
    class="relative shrink-0 overflow-hidden bg-surface-2"
    :class="rounded"
    :style="{ width: size + 'px', height: size + 'px' }"
  >
    <!-- Placeholder SIEMPRE de fondo: inicial con degradado o nota musical. La
         imagen lo tapa al cargar; mientras carga (o si falla) se ve esto en vez
         de un hueco oscuro. -->
    <div class="absolute inset-0 grid place-items-center">
      <div
        v-if="fallbackText && initial"
        class="w-full h-full grid place-items-center font-display font-bold text-white/90 select-none"
        :style="{ background: gradient, fontSize: size * 0.42 + 'px' }"
      >{{ initial }}</div>
      <svg v-else viewBox="0 0 24 24" class="w-1/2 h-1/2 text-muted/50" fill="currentColor" aria-hidden="true">
        <path d="M12 3v10.55A4 4 0 1 0 14 17V7h4V3h-6z" />
      </svg>
    </div>

    <!-- Imagen encima (transparente mientras carga → deja ver el placeholder) -->
    <img
      v-if="usableSrc && !failed"
      :src="usableSrc"
      :alt="alt ?? ''"
      loading="lazy"
      class="absolute inset-0 w-full h-full object-cover"
      @error="failed = true"
    />
  </div>
</template>
