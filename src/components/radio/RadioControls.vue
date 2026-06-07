<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import { useChartRegistryStore } from '@/stores/chartRegistry.store'
import { useRadioQueue } from '@/composables/useRadioQueue'
import { getYearTop } from '@/services/radio.service'
import type { ChartPeriod } from '@/types/chart.types'
import BaseButton from '@/components/ui/BaseButton.vue'
import BaseSlider from '@/components/ui/BaseSlider.vue'

const registry = useChartRegistryStore()
const { generate, generating, error } = useRadioQueue()

const chartId = ref('')
const year    = ref(new Date().getFullYear())
const lambda  = ref(0.35)

const selected = computed(() => registry.getById(chartId.value))
const yearTop  = ref<ChartPeriod | null>(null)
const loadingTop = ref(false)

onMounted(async () => {
  await registry.load()
  if (!chartId.value && registry.registries.length) {
    chartId.value = registry.registries[0].chartId
  }
})

// Al cambiar de fuente: ajusta λ por defecto y encaja el año en el rango.
watch(selected, (s) => {
  if (!s) return
  lambda.value = s.defaultLambda
  if (year.value > s.endYear)   year.value = s.endYear
  if (year.value < s.startYear) year.value = s.startYear
})

// Vista previa del "Top del año" para la fuente y el año elegidos.
let previewToken = 0
async function loadPreview(): Promise<void> {
  if (!chartId.value || !selected.value) { yearTop.value = null; return }
  const y = Math.min(Math.max(year.value, selected.value.startYear), selected.value.endYear)
  const token = ++previewToken
  loadingTop.value = true
  try {
    const top = await getYearTop(chartId.value, y)
    if (token === previewToken) yearTop.value = top
  } finally {
    if (token === previewToken) loadingTop.value = false
  }
}
watch([chartId, year], loadPreview, { immediate: true })

const topPreview = computed(() => (yearTop.value?.songs ?? []).slice(0, 8))
const displaySize = computed(() =>
  Math.min(selected.value?.listSize ?? 100, yearTop.value?.songs.length ?? 0)
)

async function onGenerate(): Promise<void> {
  if (!chartId.value) return
  await generate({ chartId: chartId.value, refYear: year.value, lambda: lambda.value })
}
</script>

<template>
  <section class="rounded-2xl bg-card border border-line p-5 space-y-5">
    <div v-if="registry.loading" class="text-sm text-muted">Cargando fuentes…</div>
    <div v-else-if="registry.registries.length === 0" class="text-sm text-amber-300">
      No hay listas disponibles. Regenera el bundle de charts (chart-pipeline/build-charts.mjs).
    </div>

    <template v-else>
      <!-- Selector de fuente / país -->
      <div>
        <label class="block text-xs font-medium text-muted mb-1.5">Lista</label>
        <div class="grid grid-cols-2 gap-2">
          <button
            v-for="r in registry.registries" :key="r.chartId"
            class="flex items-center gap-2.5 px-3 h-12 rounded-xl border text-left transition"
            :class="chartId === r.chartId ? 'border-brand bg-brand/15 text-white' : 'border-line bg-surface-2 text-muted hover:text-white'"
            @click="chartId = r.chartId"
          >
            <span class="text-xl leading-none">{{ r.flag }}</span>
            <span class="min-w-0">
              <span class="block text-sm font-semibold truncate">{{ r.name }}</span>
              <span v-if="r.subtitle" class="block text-[10px] text-muted/70 truncate">{{ r.subtitle }}</span>
            </span>
          </button>
        </div>
      </div>

      <!-- Año -->
      <div>
        <div class="flex items-center justify-between mb-1.5">
          <span class="text-xs font-medium text-muted">Año</span>
          <span v-if="selected" class="text-[10px] text-muted/60 tabular-nums">{{ selected.startYear }}–{{ selected.endYear }}</span>
        </div>
        <BaseSlider
          v-model="year"
          :min="selected?.startYear" :max="selected?.endYear" :step="1"
          aria-label="Año"
        />
        <div class="mt-1 text-center font-display text-3xl font-extrabold tabular-nums">{{ year }}</div>
      </div>

      <!-- Slider de nostalgia (mezcla de años) -->
      <div>
        <div class="flex items-center justify-between mb-1.5">
          <span class="text-xs font-medium text-muted">Nostalgia</span>
          <span class="text-[10px] text-muted/60 tabular-nums">λ = {{ lambda.toFixed(2) }}</span>
        </div>
        <BaseSlider
          v-model="lambda"
          :min="0.1" :max="1" :step="0.05"
          aria-label="Nivel de nostalgia"
        />
        <div class="flex justify-between text-[10px] text-muted/60 mt-1">
          <span>Mezcla épocas</span><span>Solo ese año</span>
        </div>
      </div>

      <BaseButton variant="brand" size="lg" class="w-full justify-center" :disabled="generating || !chartId" @click="onGenerate">
        <svg v-if="!generating" viewBox="0 0 24 24" class="w-5 h-5" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
        {{ generating ? 'Generando…' : 'Generar radio' }}
      </BaseButton>

      <p v-if="error" class="text-sm text-amber-300">{{ error }}</p>

      <!-- Vista previa: Top del año -->
      <div v-if="selected" class="pt-1 border-t border-line/60">
        <div class="flex items-baseline justify-between mb-2">
          <h3 class="text-xs font-semibold uppercase tracking-wider text-muted">Top {{ displaySize }} · {{ year }}</h3>
          <span class="text-[10px] text-muted/60">{{ selected.name }}</span>
        </div>
        <div v-if="loadingTop" class="text-xs text-muted/60">Cargando…</div>
        <ol v-else-if="topPreview.length" class="space-y-1">
          <li v-for="s in topPreview" :key="s.rank" class="flex items-center gap-2.5 text-sm">
            <span class="w-5 text-right tabular-nums text-muted/60">{{ s.rank }}</span>
            <span class="min-w-0 flex-1 truncate">
              <span class="font-medium">{{ s.titleDisplay }}</span>
              <span class="text-muted"> — {{ s.artistDisplay }}</span>
            </span>
          </li>
        </ol>
        <div v-else class="text-xs text-muted/60">Sin datos para este año.</div>
      </div>
    </template>
  </section>
</template>
