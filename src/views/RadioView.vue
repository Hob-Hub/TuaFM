<script setup lang="ts">
import { useRadioStore } from '@/stores/radio.store'
import RadioControls from '@/components/radio/RadioControls.vue'
import RadioQueueView from '@/components/radio/RadioQueueView.vue'

const radio = useRadioStore()
</script>

<template>
  <!-- Sin radio: el generador es el protagonista, centrado. Con radio: dos
       columnas, controles fijos a la izquierda y cola a un ancho cómodo de
       lectura (evita filas estiradas con la duración colgando a la derecha). -->
  <div class="p-5 sm:p-8 mx-auto" :class="radio.isActive ? 'max-w-5xl' : 'max-w-md'">
    <header class="mb-6">
      <h1 class="font-display text-2xl sm:text-3xl font-extrabold">Radio</h1>
      <p class="text-muted text-sm mt-1">La máquina del tiempo sonora — cómo habría sonado la radio ese año.</p>
    </header>

    <template v-if="!radio.isActive">
      <RadioControls />
      <p class="mt-4 text-center text-xs text-muted/70">
        Elige la lista y el año, ajusta la nostalgia y pulsa <span class="text-white/80">Generar radio</span>.
      </p>
    </template>

    <div v-else class="grid lg:grid-cols-[340px_1fr] gap-6 lg:gap-8 items-start">
      <div class="lg:sticky lg:top-6 self-start">
        <RadioControls />
      </div>
      <RadioQueueView />
    </div>
  </div>
</template>
