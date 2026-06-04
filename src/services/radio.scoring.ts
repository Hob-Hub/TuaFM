import type { ChartPeriod, RadioCandidate } from '@/types/chart.types'

// Lógica pura del algoritmo de radio (sin I/O). Aislada para poder testarla sin
// las cadenas de import de Firebase.

// year * 53 + week evita colisiones en años con semana 53 (máximo ISO week = 53).
export function toAbsWeek(year: number, week: number): number {
  return year * 53 + week
}

export function positionScore(p: number): number { return 1 / Math.sqrt(p) }
export function timeDecay(weeks: number, lambda: number): number { return Math.exp(-lambda * Math.max(0, weeks)) }
export function persistenceScore(weeks: number): number { return Math.log2(weeks + 1) }

/**
 * Agrega candidatos a partir de los periodos de chart ya descargados. Pondera
 * cada canción por posición × decaimiento temporal, acumulando apariciones, y
 * aplica persistenceScore UNA vez sobre el máximo de semanas en lista.
 */
export function aggregateCandidates(
  periods: ChartPeriod[], refYear: number, refWeek: number, lambda: number
): RadioCandidate[] {
  const refAbs = toAbsWeek(refYear, refWeek)
  const weightMap = new Map<string, RadioCandidate>()

  for (const period of periods) {
    const docAbs = toAbsWeek(period.year, period.effectiveWeek)
    if (docAbs > refAbs) continue
    const weeksAgo = refAbs - docAbs

    for (const song of period.songs) {
      const key    = `${song.artist}::${song.title}`   // artist ya normalizado en migración
      const wScore = positionScore(song.position) * timeDecay(weeksAgo, lambda)

      const existing = weightMap.get(key)
      if (existing) {
        existing.weight        += wScore
        existing.appearances   += 1
        existing.maxWeeksInList = Math.max(existing.maxWeeksInList, song.weeksInList ?? 1)
      } else {
        weightMap.set(key, {
          artist: song.artist, artistDisplay: song.artistDisplay,
          title: song.title, youtubeVideoId: song.youtubeVideoId,
          coverUrl: song.coverUrl,
          weight: wScore, appearances: 1,
          maxWeeksInList: song.weeksInList ?? 1
        })
      }
    }
  }

  for (const c of weightMap.values()) {
    c.weight *= persistenceScore(c.maxWeeksInList)
  }

  return Array.from(weightMap.values())
}

/** Muestreo ponderado sin reemplazo: top-N proporcional al peso. */
export function weightedSample(candidates: RadioCandidate[], n: number): RadioCandidate[] {
  const pool = [...candidates]
  const result: RadioCandidate[] = []
  while (result.length < n && pool.length > 0) {
    const total = pool.reduce((s, c) => s + c.weight, 0)
    if (total <= 0) break
    let rand = Math.random() * total
    for (let i = 0; i < pool.length; i++) {
      rand -= pool[i].weight
      if (rand <= 0) { result.push(pool[i]); pool.splice(i, 1); break }
    }
  }
  return result
}
