import type { ChartPeriod, ChartRegistry, ChartSong, CatalogTrack } from '@/types/chart.types'
import { getTracksById } from '@/services/catalog/static.source'

/**
 * Fuente de charts servida como JSON estático desde /public/charts.
 * Generada por chart-pipeline/build-charts.mjs.
 *
 * Los ficheros de chart son COMPACTOS: cada canción referencia el catálogo de
 * tracks por id (`{ t, r, s, p, w }`). Aquí se hidratan con public/catalog/tracks.json
 * para reconstruir la forma rica `ChartSong` que consumen scoring y UI.
 *
 * Es la única fuente de charts: funciona offline, sin backend ni cuota externa.
 * Cada fichero se carga perezosamente y se cachea en memoria.
 */

const BASE = `${import.meta.env.BASE_URL}charts/`

interface RawChartSong { t: number; r: number; s: number; p: number; w: number }
interface RawChartPeriod { year: number; songs: RawChartSong[] }

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

/** ¿Está este chart disponible en el bundle estático? */
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

// Reconstruye una ChartSong rica a partir de la entrada compacta + el catálogo.
function hydrate(raw: RawChartSong, tracks: Map<number, CatalogTrack>): ChartSong | null {
  const t = tracks.get(raw.t)
  if (!t) return null
  const sep = t.key.indexOf('::')
  const artist = sep >= 0 ? t.key.slice(0, sep) : t.key
  const title  = sep >= 0 ? t.key.slice(sep + 2) : t.key
  return {
    rank: raw.r, position: raw.r, score: raw.s, peakPosition: raw.p, weeksOnChart: raw.w,
    artist, title,
    artistDisplay: t.artist, titleDisplay: t.title,
    youtubeVideoId: t.youtubeVideoId,
    coverUrl: t.coverUrl,
    chartYear: t.chartYear,
    duration: t.durationMs,
    language: t.language,
    languageConfidence: t.languageConfidence,
    languageSource: t.languageSource
  }
}

function loadChart(chartId: string): Promise<ChartPeriod[]> {
  let p = chartPromises.get(chartId)
  if (!p) {
    p = Promise.all([
      fetchJson<{ chartId: string; periods: RawChartPeriod[] }>(`${chartId}.json`),
      getTracksById()
    ])
      .then(([data, tracks]) => data.periods.map(period => ({
        chartId,
        year: period.year,
        songs: period.songs
          .map(raw => hydrate(raw, tracks))
          .filter((s): s is ChartSong => s !== null)
      })))
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
