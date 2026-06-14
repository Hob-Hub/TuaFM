import { ref } from 'vue'
import { i18n } from '@/i18n'
import { generateRadioQueue, generateMoreRadioTracks } from '@/services/radio.service'
import { useRadioStore } from '@/stores/radio.store'
import { usePlayerStore } from '@/stores/player.store'
import { useChartRegistryStore } from '@/stores/chartRegistry.store'
import { useRecentRadiosStore } from '@/stores/recentRadios.store'

// Estado compartido entre instancias: evita extensiones concurrentes (la cola
// puede ampliarse desde el botón "Cargar más" y desde el auto-prefetch a la vez).
const extending = ref(false)

export function useRadioQueue() {
  const radioStore    = useRadioStore()
  const playerStore   = usePlayerStore()
  const registryStore = useChartRegistryStore()
  const recentRadios  = useRecentRadiosStore()
  const generating    = ref(false)
  const error         = ref<string | null>(null)

  async function generate(params: {
    chartId: string; refYear: number
    queueSize?: number; windowYears?: number; lambda?: number
  }): Promise<boolean> {
    generating.value = true
    error.value      = null
    try {
      const { tracks, resolvedLambda } = await generateRadioQueue(params)
      if (tracks.length === 0) {
        error.value = i18n.global.t('radio.noDataForYear')
        return false
      }
      const registry = registryStore.getById(params.chartId)
      radioStore.setQueue(tracks, {
        chartId: params.chartId,
        country: registry?.country ?? '',
        name:    registry?.name ?? params.chartId,
        year:    params.refYear,
        lambda:  resolvedLambda,
        window:  params.windowYears ?? 6
      })
      recentRadios.record({
        chartId: params.chartId,
        year:    params.refYear,
        lambda:  resolvedLambda,
        country: registry?.country ?? '',
        name:    registry?.name ?? params.chartId,
        flag:    registry?.flag ?? '🎵'
      })
      playerStore.queueMode = 'radio'
      return true
    } catch (e) {
      error.value = (e as Error).message
      return false
    } finally {
      generating.value = false
    }
  }

  /** Amplía la cola actual con más pistas (radio infinita). */
  async function extend(count = 25): Promise<boolean> {
    if (extending.value) return false
    const chartId = radioStore.activeChartId
    if (!chartId) return false
    extending.value = true
    try {
      const existing = new Set(radioStore.queue.map(t => `${t.artist}::${t.title}`))
      const tracks = await generateMoreRadioTracks({
        chartId,
        refYear:     radioStore.activeYear,
        windowYears: radioStore.activeWindow,
        lambda:      radioStore.activeLambda,
        excludeKeys: existing,
        count
      })
      if (tracks.length === 0) return false
      radioStore.appendQueue(tracks)
      return true
    } catch {
      return false
    } finally {
      extending.value = false
    }
  }

  return { generate, generating, error, extend, extending }
}
