import type { ChartPeriod, ChartRegistry } from '@/types/chart.types'
import { isFirebaseConfigured } from '@/firebase/index'
import * as staticSrc    from './static.source'
import * as firestoreSrc from './firestore.source'

/**
 * Capa de acceso a datos de charts con estrategia **static-first + fallback**.
 *
 *  - Los charts incluidos en el bundle estático (/public/charts) se sirven
 *    siempre desde local: funcionan offline, sin cuota de Firestore y aunque
 *    Firebase esté caído.
 *  - Los charts que solo existen en Firestore (p. ej. añadidos sin re-exportar)
 *    siguen funcionando online a través de la fuente Firestore.
 *
 * Así Firebase pasa de dependencia crítica a mejora opcional. Para regenerar el
 * bundle local: `node scripts/export-charts-static.mjs chart-configs/<chart>.json`.
 */

export interface ChartDataSource {
  listRegistries(): Promise<ChartRegistry[]>
  getRegistry(chartId: string): Promise<ChartRegistry | null>
  getPeriods(chartId: string, minYear: number, maxYear: number): Promise<ChartPeriod[]>
}

/** Une registries locales y de Firestore; el estático tiene prioridad. */
async function listRegistries(): Promise<ChartRegistry[]> {
  const local = await staticSrc.listRegistries().catch(() => [] as ChartRegistry[])
  let remote: ChartRegistry[] = []
  if (isFirebaseConfigured) {
    try {
      remote = await firestoreSrc.listRegistries()
    } catch (err) {
      console.warn('[chartData] Firestore registries no disponibles, uso solo local:', err)
    }
  }
  const byId = new Map<string, ChartRegistry>()
  for (const r of remote) byId.set(r.chartId, r)
  for (const r of local)  byId.set(r.chartId, r)   // el local pisa al remoto
  return [...byId.values()]
}

async function getRegistry(chartId: string): Promise<ChartRegistry | null> {
  const local = await staticSrc.getRegistry(chartId).catch(() => null)
  if (local || !isFirebaseConfigured) return local
  try {
    return await firestoreSrc.getRegistry(chartId)
  } catch (err) {
    console.warn(`[chartData] getRegistry(${chartId}) Firestore falló:`, err)
    return null
  }
}

async function getPeriods(
  chartId: string, minYear: number, maxYear: number
): Promise<ChartPeriod[]> {
  if (await staticSrc.hasChart(chartId)) {
    return staticSrc.getPeriods(chartId, minYear, maxYear)
  }
  if (!isFirebaseConfigured) return []
  return firestoreSrc.getPeriods(chartId, minYear, maxYear)
}

export const chartData: ChartDataSource = { listRegistries, getRegistry, getPeriods }
