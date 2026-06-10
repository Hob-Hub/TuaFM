import type { ChartPeriod, ChartRegistry } from '@/types/chart.types'
import * as staticSrc from './static.source'

/**
 * Capa de acceso a datos de charts servida desde el **bundle estático**
 * (/public/charts): funciona offline, sin backend ni cuota externa. Para
 * regenerar el bundle: `cd chart-pipeline && node build-charts.mjs`.
 */

export interface ChartDataSource {
  listRegistries(): Promise<ChartRegistry[]>
  getRegistry(chartId: string): Promise<ChartRegistry | null>
  getPeriods(chartId: string, minYear: number, maxYear: number): Promise<ChartPeriod[]>
}

async function listRegistries(): Promise<ChartRegistry[]> {
  return staticSrc.listRegistries().catch(() => [] as ChartRegistry[])
}

async function getRegistry(chartId: string): Promise<ChartRegistry | null> {
  return staticSrc.getRegistry(chartId).catch(() => null)
}

async function getPeriods(
  chartId: string, minYear: number, maxYear: number
): Promise<ChartPeriod[]> {
  if (await staticSrc.hasChart(chartId)) {
    return staticSrc.getPeriods(chartId, minYear, maxYear)
  }
  return []
}

export const chartData: ChartDataSource = { listRegistries, getRegistry, getPeriods }
