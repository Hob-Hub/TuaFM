<script setup lang="ts">
import { ref, watch, nextTick } from 'vue'
import { useRadioStore } from '@/stores/radio.store'
import { useRadioQueue } from '@/composables/useRadioQueue'
import { usePlayback } from '@/composables/usePlayback'
import { nostalgiaLabel } from '@/utils/radioLabels'
import RadioControls from '@/components/radio/RadioControls.vue'
import RadioQueueView from '@/components/radio/RadioQueueView.vue'

const radio = useRadioStore()
const { generate, generating } = useRadioQueue()
const playback = usePlayback()

// Con una radio activa, el generador se colapsa a una barra-resumen fija: toda
// la barra abre el menú, y "Regenerar" re-tira la radio con la misma fuente. Al
// regenerar con otros ajustes, el menú se recoge solo.
const showControls = ref(false)
const controlsEl = ref<HTMLElement | null>(null)
watch(
  () => `${radio.sourceLabel}|${radio.activeYear}|${radio.activeLambda}`,
  () => { showControls.value = false }
)

// Al abrir los ajustes con la cola scrolleada, el panel se despliega arriba (bajo
// la barra-resumen) y quedaba fuera de pantalla: había que subir a mano. Lo
// traemos a la vista. El scroll-margin deja hueco para topbar + barra sticky.
function toggleControls(): void {
  showControls.value = !showControls.value
  if (showControls.value) {
    void nextTick(() => controlsEl.value?.scrollIntoView({ behavior: 'smooth', block: 'start' }))
  }
}

async function regenerate(): Promise<void> {
  if (generating.value || !radio.activeChartId) return
  const ok = await generate({
    chartId: radio.activeChartId,
    refYear: radio.activeYear,
    lambda:  radio.activeLambda
  })
  if (ok) playback.playRadioIndex(0)
}
</script>

<template>
  <!-- Sin radio: el generador es el protagonista, centrado y ancho. Con radio:
       barra-resumen fija + cola a todo el ancho; el generador se despliega bajo
       demanda tocando la barra. -->
  <div class="p-5 sm:p-8 mx-auto" :class="radio.isActive ? 'max-w-3xl' : 'max-w-2xl'">
    <header class="mb-6">
      <h1 class="font-display text-2xl sm:text-3xl font-extrabold">{{ $t('radio.title') }}</h1>
      <p class="text-muted text-sm mt-1">{{ $t('radio.subtitle') }}</p>
    </header>

    <template v-if="!radio.isActive">
      <RadioControls />
      <p class="mt-4 text-center text-xs text-muted/70">
        <i18n-t keypath="radio.generateHint" tag="span">
          <template #action><span class="text-white/80">{{ $t('radio.generateHintAction') }}</span></template>
        </i18n-t>
      </p>
    </template>

    <template v-else>
      <!-- Barra-resumen fija. Botón-overlay invisible: toda la barra abre el
           menú; "Regenerar" y el contenido quedan por encima sin anidar botones. -->
      <div class="sticky top-14 md:top-0 z-10 bg-surface/95 backdrop-blur pt-1 pb-3">
        <div
          class="relative flex items-center gap-3 rounded-2xl bg-card border px-4 py-3 transition-colors"
          :class="showControls ? 'border-brand/60' : 'border-line'"
        >
          <button
            class="absolute inset-0 rounded-2xl"
            :aria-label="showControls ? $t('radio.closeSettings') : $t('radio.openSettings')"
            :aria-expanded="showControls"
            @click="toggleControls"
          />

          <span class="grid place-items-center w-10 h-10 rounded-xl bg-brand/20 text-brand shrink-0 pointer-events-none">
            <svg viewBox="0 0 24 24" class="w-5 h-5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 8h16v11H4zM8 4l8 3M12 13a2 2 0 1 0 0 4 2 2 0 0 0 0-4z"/></svg>
          </span>
          <div class="min-w-0 pointer-events-none">
            <p class="text-sm font-semibold text-white truncate">{{ radio.sourceLabel }}</p>
            <p class="text-xs text-muted truncate">{{ nostalgiaLabel(radio.activeLambda) }} · {{ $t('common.songs', radio.queue.length) }}</p>
          </div>

          <button
            class="relative ml-auto shrink-0 flex items-center gap-1.5 px-3 h-9 rounded-xl bg-surface-2 border border-line text-sm text-muted hover:text-white disabled:opacity-60 transition-colors"
            :disabled="generating"
            @click="regenerate"
          >
            <svg viewBox="0 0 24 24" class="w-4 h-4" :class="generating && 'animate-spin'" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 2l4 4-4 4M3 11V9a4 4 0 0 1 4-4h14M7 22l-4-4 4-4M21 13v2a4 4 0 0 1-4 4H3"/></svg>
            <span class="hidden sm:inline">{{ generating ? $t('common.generating') : $t('radio.regenerate') }}</span>
          </button>

          <svg viewBox="0 0 24 24" class="w-5 h-5 text-muted shrink-0 pointer-events-none transition-transform"
               :class="showControls && 'rotate-180'" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg>
        </div>
      </div>

      <!-- Generador completo, desplegable (flujo normal: "Generar" siempre alcanzable). -->
      <Transition name="ctrl">
        <div v-if="showControls" ref="controlsEl" class="mb-5 scroll-mt-28 md:scroll-mt-4">
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
