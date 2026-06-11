<script setup lang="ts">
import { ref, watch } from 'vue'
import { useRadioStore } from '@/stores/radio.store'
import RadioControls from '@/components/radio/RadioControls.vue'
import RadioQueueView from '@/components/radio/RadioQueueView.vue'

const radio = useRadioStore()

// Con una radio activa, los controles se colapsan a una barra-resumen fija y la
// cola ocupa todo el ancho. "Cambiar" despliega el generador completo. Al
// regenerar (cambia la fuente/año/nostalgia) se recoge solo.
const showControls = ref(false)
watch(
  () => `${radio.sourceLabel}|${radio.activeYear}|${radio.activeLambda}`,
  () => { showControls.value = false }
)
</script>

<template>
  <!-- Sin radio: el generador es el protagonista, centrado. Con radio: barra
       compacta fija con el resumen + cola a todo el ancho; el generador se
       despliega bajo demanda con "Cambiar". -->
  <div class="p-5 sm:p-8 mx-auto" :class="radio.isActive ? 'max-w-3xl' : 'max-w-md'">
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

    <template v-else>
      <!-- Barra-resumen fija -->
      <div class="sticky top-14 md:top-0 z-10 bg-surface/95 backdrop-blur pt-1 pb-3">
        <div class="flex items-center gap-3 rounded-2xl bg-card border border-line px-4 py-3">
          <span class="grid place-items-center w-10 h-10 rounded-xl bg-brand/20 text-brand shrink-0">
            <svg viewBox="0 0 24 24" class="w-5 h-5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 8h16v11H4zM8 4l8 3M12 13a2 2 0 1 0 0 4 2 2 0 0 0 0-4z"/></svg>
          </span>
          <div class="min-w-0">
            <p class="text-sm font-semibold text-white truncate">{{ radio.sourceLabel }}</p>
            <p class="text-xs text-muted">Nostalgia {{ radio.activeLambda.toFixed(2) }} · {{ radio.queue.length }} canciones</p>
          </div>
          <button
            class="ml-auto shrink-0 flex items-center gap-1.5 px-3 h-9 rounded-xl border text-sm transition-colors"
            :class="showControls ? 'border-brand bg-brand/15 text-white' : 'border-line text-muted hover:text-white'"
            :aria-expanded="showControls"
            @click="showControls = !showControls"
          >
            <svg viewBox="0 0 24 24" class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/></svg>
            {{ showControls ? 'Cerrar' : 'Cambiar' }}
          </button>
        </div>
      </div>

      <!-- Generador completo, desplegable (en flujo normal: el botón Generar
           siempre es alcanzable al hacer scroll). -->
      <Transition name="ctrl">
        <div v-if="showControls" class="max-w-md mb-5">
          <RadioControls />
        </div>
      </Transition>

      <!-- Cola a todo el ancho -->
      <RadioQueueView />
    </template>
  </div>
</template>

<style scoped>
.ctrl-enter-active, .ctrl-leave-active { transition: opacity .15s ease, transform .15s ease; }
.ctrl-enter-from, .ctrl-leave-to { opacity: 0; transform: translateY(-6px); }
</style>
