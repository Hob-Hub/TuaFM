import type { ChartPeriod, RadioCandidate } from '@/types/chart.types'

// Lógica pura del algoritmo de radio (sin I/O). Aislada para poder testarla
// sin arrastrar dependencias de servicios.
//
// Modelo ANUAL: cada canción trae ya su `score` del año (Σ 1/√posición de sus
// semanas, calculado en la consolidación). La radio mezcla varios años con un
// decaimiento por DISTANCIA EN AÑOS respecto al año de referencia — el control de
// "nostalgia": λ alto ≈ solo ese año; λ bajo ≈ mezcla de épocas.

/** Decaimiento temporal por años de distancia. 1 en el propio año. */
export function timeDecay(yearsAgo: number, lambda: number): number {
  return Math.exp(-lambda * Math.max(0, yearsAgo))
}

/**
 * Agrega candidatos a partir de los Top anuales descargados. Pondera cada
 * canción por su `score` anual × decaimiento según los años que la separan del
 * año de referencia, acumulando entre años (una canción que reaparece varios
 * años suma peso).
 */
export function aggregateCandidates(
  periods: ChartPeriod[], refYear: number, lambda: number
): RadioCandidate[] {
  const map = new Map<string, RadioCandidate>()

  for (const period of periods) {
    if (period.year > refYear) continue          // nunca usar el futuro
    const decay = timeDecay(refYear - period.year, lambda)

    for (const song of period.songs) {
      const key    = `${song.artist}::${song.title}`   // artist ya normalizado
      const wScore = song.score * decay

      const existing = map.get(key)
      if (existing) {
        existing.weight      += wScore
        existing.score       += song.score
        existing.appearances += 1
        if (!existing.youtubeVideoId && song.youtubeVideoId) existing.youtubeVideoId = song.youtubeVideoId
        if (!existing.coverUrl && song.coverUrl)             existing.coverUrl       = song.coverUrl
        if (!existing.chartYear && song.chartYear)           existing.chartYear      = song.chartYear
        if (!existing.duration && song.duration)             existing.duration       = song.duration
        if (!existing.language && song.language)             existing.language       = song.language
        if (!existing.languageConfidence && song.languageConfidence !== undefined) existing.languageConfidence = song.languageConfidence
        if (!existing.languageSource && song.languageSource) existing.languageSource  = song.languageSource
      } else {
        map.set(key, {
          artist: song.artist, artistDisplay: song.artistDisplay,
          title: song.title, titleDisplay: song.titleDisplay ?? song.title,
          youtubeVideoId: song.youtubeVideoId,
          coverUrl: song.coverUrl,
          chartYear: song.chartYear,
          duration: song.duration,
          language: song.language,
          languageConfidence: song.languageConfidence,
          languageSource: song.languageSource,
          weight: wScore, score: song.score, appearances: 1
        })
      }
    }
  }

  return Array.from(map.values())
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
