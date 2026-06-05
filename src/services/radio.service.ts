import type { ChartRegistry, RadioCandidate } from '@/types/chart.types'
import type { Track } from '@/types/track.types'
import { aggregateCandidates, weightedSample } from '@/services/radio.scoring'
import { chartData } from '@/services/chartData'
import { nanoid } from 'nanoid'

export { weightedSample }

export async function getChartRegistry(chartId: string): Promise<ChartRegistry | null> {
  return chartData.getRegistry(chartId)
}

export async function buildRadioCandidates(
  chartId: string, refYear: number, refWeek: number,
  windowYears: number, lambda: number
): Promise<RadioCandidate[]> {
  const periods = await chartData.getPeriods(chartId, refYear - windowYears, refYear)
  return aggregateCandidates(periods, refYear, refWeek, lambda)
}

/** Devuelve también el lambda resuelto para que el store lo guarde correctamente. */
export async function generateRadioQueue(params: {
  chartId: string; refYear: number; refWeek: number
  queueSize?: number; windowYears?: number; lambda?: number
}): Promise<{ tracks: Track[]; resolvedLambda: number }> {
  const { chartId, refYear, refWeek, queueSize = 30, windowYears = 5 } = params

  let lambda = params.lambda
  if (lambda === undefined) {
    const registry = await getChartRegistry(chartId)
    lambda = registry?.defaultLambda ?? 0.008
  }

  const candidates = await buildRadioCandidates(chartId, refYear, refWeek, windowYears, lambda)
  const sampled    = weightedSample(candidates, queueSize)

  const tracks: Track[] = sampled.map(c => ({
    id: nanoid(), artist: c.artist, artistDisplay: c.artistDisplay,
    title: c.title, youtubeVideoId: c.youtubeVideoId, coverUrl: c.coverUrl,
    enriched: false
  }))

  return { tracks, resolvedLambda: lambda }
}
