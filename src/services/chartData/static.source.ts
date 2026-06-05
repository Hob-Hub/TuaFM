import type { ChartPeriod, ChartRegistry } from '@/types/chart.types'

/**
 * Fuente de charts servida como JSON estático desde /public/charts.
 * Generada por scripts/export-charts-static.mjs a partir del SQLite de origen.
 *
 * Es la fuente primaria: no depende de Firebase, funciona offline y no consume
 * cuota de Firestore. Cada fichero de chart se carga perezosamente la primera
 * vez que se pide una radio de ese chart, y se cachea en memoria.
 */

const BASE = `${import.meta.env.BASE_URL}charts/`

let registryPromise: Promise<ChartRegistry[]> | null = null
const chartPromises = new Map<string, Promise<ChartPeriod[]>>()

async function fetchJson<T>(file: string): Promise<T> {
  const res = await fetch(`${BASE}${file}`)
  if (!res.ok) throw new Error(`[chartData/static] ${file} → HTTP ${res.status}`)
  return res.json() as Promise<T>
}

export function listRegistries(): Promise<ChartRegistry[]> {
  if (!registryPromise) {
    registryPromise = fetchJson<ChartRegistry[]>('registry.json').catch(err => {
      registryPromise = null            // permite reintentar tras un fallo transitorio
      throw err
    })
  }
  return registryPromise
}

/** ¿Está este chart disponible localmente? Decide si saltarse Firestore. */
export async function hasChart(chartId: string): Promise<boolean> {
  try {
    const regs = await listRegistries()
    return regs.some(r => r.chartId === chartId)
  } catch {
    return false
  }
}

export async function getRegistry(chartId: string): Promise<ChartRegistry | null> {
  const regs = await listRegistries()
  return regs.find(r => r.chartId === chartId) ?? null
}

function loadChart(chartId: string): Promise<ChartPeriod[]> {
  let p = chartPromises.get(chartId)
  if (!p) {
    p = fetchJson<{ chartId: string; periods: ChartPeriod[] }>(`${chartId}.json`)
      .then(data => data.periods)
      .catch(err => { chartPromises.delete(chartId); throw err })
    chartPromises.set(chartId, p)
  }
  return p
}

export async function getPeriods(
  chartId: string, minYear: number, maxYear: number
): Promise<ChartPeriod[]> {
  const periods = await loadChart(chartId)
  return periods.filter(p => p.year >= minYear && p.year <= maxYear)
}
