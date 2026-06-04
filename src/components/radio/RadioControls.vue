<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import { useChartRegistryStore } from '@/stores/chartRegistry.store'
import { useRadioQueue } from '@/composables/useRadioQueue'
import BaseButton from '@/components/ui/BaseButton.vue'

const registry = useChartRegistryStore()
const { generate, generating, error } = useRadioQueue()

const chartId = ref('')
const year = ref(new Date().getFullYear())
const week = ref(isoWeek(new Date()))
const lambda = ref(0.008)

const selected = computed(() => registry.getById(chartId.value))

function isoWeek(d: Date): number {
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()))
  const day = date.getUTCDay() || 7
  date.setUTCDate(date.getUTCDate() + 4 - day)
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1))
  return Math.ceil((((date.getTime() - yearStart.getTime()) / 86400000) + 1) / 7)
}

onMounted(async () => {
  await registry.load()
  if (!chartId.value && registry.registries.length) {
    chartId.value = registry.registries[0].chartId
  }
})

// Al cambiar de chart, ajusta defaults (lambda y rango de años)
watch(selected, (s) => {
  if (!s) return
  lambda.value = s.defaultLambda
  if (year.value > s.endYear) year.value = s.endYear
  if (year.value < s.startYear) year.value = s.startYear
})

async function onGenerate(): Promise<void> {
  if (!chartId.value) return
  await generate({
    chartId: chartId.value,
    refYear: year.value,
    refWeek: week.value,
    lambda:  lambda.value
  })
}
</script>

<template>
  <section class="rounded-2xl bg-card border border-line p-5 space-y-5">
    <!-- Selector de chart -->
    <div v-if="registry.loading" class="text-sm text-muted">Cargando fuentes de charts…</div>
    <div v-else-if="registry.registries.length === 0" class="text-sm text-amber-300">
      No hay charts disponibles. Ejecuta el script de migración para poblar Firestore.
    </div>

    <template v-else>
      <div>
        <label class="block text-xs font-medium text-muted mb-1.5">Fuente</label>
        <div class="flex flex-wrap gap-2">
          <button
            v-for="r in registry.registries" :key="r.chartId"
            class="flex items-center gap-2 px-3 h-10 rounded-xl border text-sm transition"
            :class="chartId === r.chartId ? 'border-brand bg-brand/15 text-white' : 'border-line bg-surface-2 text-muted hover:text-white'"
            @click="chartId = r.chartId"
          >
            <span class="text-base">{{ r.flag }}</span> {{ r.shortName }}
          </button>
        </div>
      </div>

      <div class="grid grid-cols-2 gap-4">
        <label class="block">
          <span class="block text-xs font-medium text-muted mb-1.5">
            Año <span v-if="selected" class="text-muted/60">({{ selected.startYear }}–{{ selected.endYear }})</span>
          </span>
          <input
            v-model.number="year" type="number"
            :min="selected?.startYear" :max="selected?.endYear"
            aria-label="Año"
            class="w-full h-10 px-3 rounded-xl bg-surface-2 border border-line focus:outline-none focus:border-brand/70 tabular-nums"
          />
        </label>
        <label class="block">
          <span class="block text-xs font-medium text-muted mb-1.5">Semana (1–53)</span>
          <input
            v-model.number="week" type="number" min="1" max="53"
            aria-label="Semana"
            class="w-full h-10 px-3 rounded-xl bg-surface-2 border border-line focus:outline-none focus:border-brand/70 tabular-nums"
          />
        </label>
      </div>

      <!-- Slider de nostalgia -->
      <div>
        <div class="flex items-center justify-between mb-1.5">
          <span class="text-xs font-medium text-muted">Nostalgia</span>
          <span class="text-[10px] text-muted/60 tabular-nums">λ = {{ lambda.toFixed(3) }}</span>
        </div>
        <input
          v-model.number="lambda" type="range" min="0.003" max="0.015" step="0.001"
          aria-label="Nivel de nostalgia"
          class="w-full accent-brand cursor-pointer"
        />
        <div class="flex justify-between text-[10px] text-muted/60 mt-1">
          <span>Mezcla épocas</span><span>Solo reciente</span>
        </div>
      </div>

      <BaseButton variant="brand" size="lg" class="w-full justify-center" :disabled="generating || !chartId" @click="onGenerate">
        <svg v-if="!generating" viewBox="0 0 24 24" class="w-5 h-5" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
        {{ generating ? 'Generando…' : 'Generar radio' }}
      </BaseButton>

      <p v-if="error" class="text-sm text-amber-300">{{ error }}</p>
    </template>
  </section>
</template>
