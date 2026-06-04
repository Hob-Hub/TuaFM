import { collection, query, where, getDocs, doc, getDoc } from 'firebase/firestore'
import { firestore } from '@/firebase/index'
import type { ChartPeriod, ChartRegistry, RadioCandidate } from '@/types/chart.types'
import type { Track } from '@/types/track.types'
import { aggregateCandidates, weightedSample } from '@/services/radio.scoring'
import { nanoid } from 'nanoid'

export { weightedSample }

export async function getChartRegistry(chartId: string): Promise<ChartRegistry | null> {
  const snap = await getDoc(doc(firestore, 'chart_registry', chartId))
  return snap.exists() ? (snap.data() as ChartRegistry) : null
}

export async function buildRadioCandidates(
  chartId: string, refYear: number, refWeek: number,
  windowYears: number, lambda: number
): Promise<RadioCandidate[]> {
  const q = query(
    collection(firestore, 'chart_periods'),
    where('chartId', '==', chartId),
    where('year', '>=', refYear - windowYears),
    where('year', '<=', refYear)
  )
  const snap    = await getDocs(q)
  const periods = snap.docs.map(d => d.data() as ChartPeriod)
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
