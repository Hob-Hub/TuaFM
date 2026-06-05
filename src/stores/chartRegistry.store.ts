import { defineStore } from 'pinia'
import { ref, readonly } from 'vue'
import { chartData } from '@/services/chartData'
import type { ChartRegistry } from '@/types/chart.types'

export const useChartRegistryStore = defineStore('chartRegistry', () => {
  const registries = ref<ChartRegistry[]>([])
  const loaded     = ref(false)
  const loading    = ref(false)
  const error      = ref<string | null>(null)

  async function load(): Promise<void> {
    if (loaded.value || loading.value) return
    loading.value = true
    error.value   = null
    try {
      registries.value = await chartData.listRegistries()
      loaded.value = true
    } catch (e) {
      error.value = (e as Error).message
    } finally {
      loading.value = false
    }
  }

  function getById(chartId: string): ChartRegistry | undefined {
    return registries.value.find(r => r.chartId === chartId)
  }

  return {
    registries: readonly(registries),
    loaded:     readonly(loaded),
    loading:    readonly(loading),
    error:      readonly(error),
    load, getById
  }
})
