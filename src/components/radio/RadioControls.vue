<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import { useRouter } from 'vue-router'
import { makeTrack } from '@/utils/track'
import { useChartRegistryStore } from '@/stores/chartRegistry.store'
import { useRadioStore } from '@/stores/radio.store'
import { useRadioQueue } from '@/composables/useRadioQueue'
import { usePlayback } from '@/composables/usePlayback'
import { getYearTop } from '@/services/radio.service'
import { nostalgiaLabel } from '@/utils/radioLabels'
import { chartCountryName } from '@/utils/chartLabels'
import type { ChartPeriod, ChartRegistry, ChartSong } from '@/types/chart.types'
import BaseButton from '@/components/ui/BaseButton.vue'
import BaseSlider from '@/components/ui/BaseSlider.vue'

const registry = useChartRegistryStore()
const radioStore = useRadioStore()
const playback = usePlayback()
const router = useRouter()
const { generate, generating, error } = useRadioQueue()

const chartId = ref('')
const year    = ref(new Date().getFullYear())
const lambda  = ref(0.35)

const selected = computed(() => registry.getById(chartId.value))
const yearTop  = ref<ChartPeriod | null>(null)
const loadingTop = ref(false)

/** Año por defecto: el del medio del rango de la fuente. */
function midYear(r: ChartRegistry): number {
  return Math.round((r.startYear + r.endYear) / 2)
}

/** Selección manual de fuente: fija λ por defecto y centra el año. */
function selectChart(r: ChartRegistry): void {
  chartId.value = r.chartId
  lambda.value  = r.defaultLambda
  year.value    = midYear(r)
}

onMounted(async () => {
  await registry.load()
  if (!registry.registries.length) return

  // Reanuda la última configuración usada si sigue siendo válida…
  const saved = radioStore.activeChartId ? registry.getById(radioStore.activeChartId) : null
  if (saved) {
    chartId.value = saved.chartId
    year.value    = Math.min(Math.max(radioStore.activeYear, saved.startYear), saved.endYear)
    lambda.value  = radioStore.activeLambda
  } else {
    // …o arranca en la primera fuente, centrada en su año medio.
    selectChart(registry.registries[0])
  }
})

// Mantiene el año dentro del rango de la fuente activa (seguridad).
watch(selected, (s) => {
  if (!s) return
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

// Preview del Top del año: plegable; un teaser corto, la lista completa va a su vista.
const previewOpen = ref(false)
const PREVIEW_N   = 10

const allSongs    = computed(() => yearTop.value?.songs ?? [])
const visibleSongs = computed(() => allSongs.value.slice(0, PREVIEW_N))
const displaySize = computed(() =>
  Math.min(selected.value?.listSize ?? 100, allSongs.value.length)
)

/** Reproduce una canción del Top como pista única (efímera), como en Buscar. */
function playSong(s: ChartSong): void {
  playback.playSingle(makeTrack({
    artist: s.artist, title: s.title,
    artistDisplay: s.artistDisplay, titleDisplay: s.titleDisplay,
    youtubeVideoId: s.youtubeVideoId, coverUrl: s.coverUrl,
    language: s.language,
    languageConfidence: s.languageConfidence,
    languageSource: s.languageSource
  }))
}

/** Abre la vista con el Top completo del año. */
function openFullChart(): void {
  if (chartId.value) router.push({ name: 'chart', params: { chartId: chartId.value, year: year.value } })
}

async function onGenerate(): Promise<void> {
  if (!chartId.value) return
  const ok = await generate({ chartId: chartId.value, refYear: year.value, lambda: lambda.value })
  if (ok) playback.playRadioIndex(0)   // arranca la radio al instante
}
</script>

<template>
  <section class="rounded-2xl bg-card border border-line p-5 space-y-5">
    <div v-if="registry.loading" class="text-sm text-muted">{{ $t('radio.loadingSources') }}</div>
    <div v-else-if="registry.registries.length === 0" class="text-sm text-amber-300">
      {{ $t('radio.noLists') }}
    </div>

    <template v-else>
      <!-- País / lista: chips que envuelven (escala a más fuentes) -->
      <div>
        <label class="block text-xs font-medium text-muted mb-2">{{ $t('radio.list') }}</label>
        <div class="flex flex-wrap gap-2">
          <button
            v-for="r in registry.registries" :key="r.chartId"
            class="flex items-center gap-2 px-3 h-11 rounded-xl border transition"
            :class="chartId === r.chartId ? 'border-brand bg-brand/15 text-white' : 'border-line bg-surface-2 text-muted hover:text-white'"
            @click="selectChart(r)"
          >
            <span class="text-lg leading-none">{{ r.flag }}</span>
            <span class="text-sm font-semibold whitespace-nowrap">{{ chartCountryName(r.country, r.name) }}</span>
            <span v-if="r.subtitle" class="text-[10px] text-muted/70 whitespace-nowrap">· {{ r.subtitle }}</span>
          </button>
        </div>
      </div>

      <!-- Año + Nostalgia: lado a lado en pantallas anchas -->
      <div class="grid sm:grid-cols-2 gap-x-6 gap-y-5">
        <!-- Año -->
        <div>
          <div class="flex items-baseline justify-between mb-2">
            <span class="text-xs font-medium text-muted">{{ $t('radio.year') }}</span>
            <span class="font-display text-2xl font-extrabold tabular-nums leading-none">{{ year }}</span>
          </div>
          <BaseSlider
            v-model="year" show-thumb
            :min="selected?.startYear" :max="selected?.endYear" :step="1"
            :aria-label="$t('radio.yearAria')"
          />
          <div v-if="selected" class="flex justify-between text-[10px] text-muted/80 mt-1 tabular-nums">
            <span>{{ selected.startYear }}</span><span>{{ selected.endYear }}</span>
          </div>
        </div>

        <!-- Nostalgia: etiqueta humana en vez del λ crudo -->
        <div>
          <div class="flex items-baseline justify-between mb-2">
            <span class="text-xs font-medium text-muted">{{ $t('radio.nostalgiaLabel') }}</span>
            <span class="text-sm font-semibold text-white">{{ nostalgiaLabel(lambda) }}</span>
          </div>
          <BaseSlider
            v-model="lambda" show-thumb
            :min="0.1" :max="1" :step="0.05"
            :aria-label="$t('radio.nostalgiaAria')"
          />
          <div class="flex justify-between text-[10px] text-muted/80 mt-1">
            <span>{{ $t('radio.mixEras') }}</span><span>{{ $t('radio.onlyThatYear') }}</span>
          </div>
        </div>
      </div>

      <BaseButton variant="brand" size="lg" class="w-full justify-center" :disabled="generating || !chartId" @click="onGenerate">
        <svg v-if="!generating" viewBox="0 0 24 24" class="w-5 h-5" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
        {{ generating ? $t('common.generating') : $t('radio.generate') }}
      </BaseButton>

      <p v-if="error" class="text-sm text-amber-300">{{ error }}</p>

      <!-- Vista previa: Top del año (plegable; clic en una canción la reproduce) -->
      <div v-if="selected" class="pt-1 border-t border-line/60">
        <button
          class="w-full flex items-center justify-between -mx-1 px-1 py-1 rounded-lg hover:bg-card-hover"
          :aria-expanded="previewOpen"
          @click="previewOpen = !previewOpen"
        >
          <span class="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted">
            <svg viewBox="0 0 24 24" class="w-3.5 h-3.5 transition-transform" :class="previewOpen && 'rotate-90'"
                 fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6l6 6-6 6"/></svg>
            {{ $t('radio.previewTop', { count: displaySize, year }) }}
          </span>
          <span class="text-[10px] text-muted/80">{{ chartCountryName(selected.country, selected.name) }}</span>
        </button>

        <div v-show="previewOpen" class="mt-2">
          <div v-if="loadingTop" class="text-xs text-muted/80">{{ $t('common.loading') }}</div>
          <template v-else-if="allSongs.length">
            <ol class="space-y-0.5">
              <li v-for="s in visibleSongs" :key="s.rank">
                <button
                  class="group w-full flex items-center gap-2.5 text-sm text-left px-1 py-1 rounded-lg hover:bg-card-hover"
                  @click="playSong(s)"
                >
                  <span class="w-5 text-right tabular-nums text-muted/80 group-hover:hidden">{{ s.rank }}</span>
                  <span class="w-5 hidden group-hover:grid place-items-center text-brand">
                    <svg viewBox="0 0 24 24" class="w-3.5 h-3.5" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
                  </span>
                  <span class="min-w-0 flex-1 truncate">
                    <span class="font-medium">{{ s.titleDisplay }}</span>
                    <span class="text-muted"> — {{ s.artistDisplay }}</span>
                  </span>
                </button>
              </li>
            </ol>
            <button
              v-if="allSongs.length > PREVIEW_N"
              class="mt-2 inline-flex items-center gap-1 text-xs text-brand hover:underline"
              @click="openFullChart"
            >
              {{ $t('radio.seeFullTop', { count: displaySize }) }}
              <svg viewBox="0 0 24 24" class="w-3.5 h-3.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M13 6l6 6-6 6"/></svg>
            </button>
          </template>
          <div v-else class="text-xs text-muted/80">{{ $t('radio.noYearData') }}</div>
        </div>
      </div>
    </template>
  </section>
</template>
