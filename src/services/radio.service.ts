import type { ChartPeriod, ChartRegistry, RadioCandidate } from '@/types/chart.types'
import type { Track } from '@/types/track.types'
import { aggregateCandidates, weightedSample } from '@/services/radio.scoring'
import { chartData } from '@/services/chartData'
import { nanoid } from 'nanoid'

export { weightedSample }

export async function getChartRegistry(chartId: string): Promise<ChartRegistry | null> {
  return chartData.getRegistry(chartId)
}

/** Top consolidado de un único año (para la vista previa "Top del año"). */
export async function getYearTop(chartId: string, year: number): Promise<ChartPeriod | null> {
  const periods = await chartData.getPeriods(chartId, year, year)
  return periods[0] ?? null
}

export async function buildRadioCandidates(
  chartId: string, refYear: number, windowYears: number, lambda: number
): Promise<RadioCandidate[]> {
  const periods = await chartData.getPeriods(chartId, refYear - windowYears, refYear)
  return aggregateCandidates(periods, refYear, lambda)
}

/** Devuelve también el lambda resuelto para que el store lo guarde correctamente. */
export async function generateRadioQueue(params: {
  chartId: string; refYear: number
  queueSize?: number; windowYears?: number; lambda?: number
}): Promise<{ tracks: Track[]; resolvedLambda: number }> {
  const { chartId, refYear, queueSize = 30, windowYears = 6 } = params

  let lambda = params.lambda
  if (lambda === undefined) {
    const registry = await getChartRegistry(chartId)
    lambda = registry?.defaultLambda ?? 0.35
  }

  const candidates = await buildRadioCandidates(chartId, refYear, windowYears, lambda)
  const sampled    = weightedSample(candidates, queueSize)

  const tracks: Track[] = sampled.map(c => ({
    id: nanoid(), artist: c.artist, artistDisplay: c.artistDisplay,
    title: c.title, titleDisplay: c.titleDisplay,
    youtubeVideoId: c.youtubeVideoId, coverUrl: c.coverUrl,
    enriched: false
  }))

  return { tracks, resolvedLambda: lambda }
}
