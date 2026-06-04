import { ref } from 'vue'
import { generateRadioQueue } from '@/services/radio.service'
import { useRadioStore } from '@/stores/radio.store'
import { usePlayerStore } from '@/stores/player.store'
import { useChartRegistryStore } from '@/stores/chartRegistry.store'

export function useRadioQueue() {
  const radioStore    = useRadioStore()
  const playerStore   = usePlayerStore()
  const registryStore = useChartRegistryStore()
  const generating    = ref(false)
  const error         = ref<string | null>(null)

  async function generate(params: {
    chartId: string; refYear: number; refWeek: number
    queueSize?: number; windowYears?: number; lambda?: number
  }): Promise<boolean> {
    generating.value = true
    error.value      = null
    try {
      const { tracks, resolvedLambda } = await generateRadioQueue(params)
      if (tracks.length === 0) {
        error.value = 'No hay datos de chart para ese periodo. Prueba otro año o semana.'
        return false
      }
      const registry = registryStore.getById(params.chartId)
      const label    = `${registry?.shortName ?? params.chartId} · ${params.refYear} sem. ${params.refWeek}`
      radioStore.setQueue(tracks, label, {
        chartId: params.chartId,
        year:    params.refYear,
        week:    params.refWeek,
        lambda:  resolvedLambda,
        window:  params.windowYears ?? 5
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

  return { generate, generating, error }
}
