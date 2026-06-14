import { defineStore } from 'pinia'
import { ref } from 'vue'

export interface RecentRadio {
  chartId: string
  year:    number
  lambda:  number
  country: string     // ISO del país: el nombre se localiza en runtime
  name:    string     // nombre original de la lista (fallback si no hay país/clave)
  flag:    string     // emoji bandera
  at:      number     // timestamp de la última vez generada
}

/**
 * Historial de radios generadas, para reofrecerlas en Inicio ("Volver a
 * escuchar"). Se deduplica por lista+año y se conserva la más reciente primero.
 */
export const useRecentRadiosStore = defineStore('recentRadios', () => {
  const items = ref<RecentRadio[]>([])

  function record(r: Omit<RecentRadio, 'at'>): void {
    items.value = [
      { ...r, at: Date.now() },
      ...items.value.filter(x => !(x.chartId === r.chartId && x.year === r.year))
    ].slice(0, 8)
  }

  function clear(): void { items.value = [] }

  return { items, record, clear }
}, {
  persist: true
})
