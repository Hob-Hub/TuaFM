import type { PlayHistoryEntry } from '@/types/playlist.types'
import { makeCacheKey } from '@/utils/normalize'

/**
 * Cuánto "gustó" una reproducción, a partir de sus señales de escucha. Es una
 * heurística pura (sin red ni estado), pensada para sembrar las recomendaciones
 * con lo que el usuario de verdad escucha, no solo con sus favoritos explícitos.
 *
 *   - base: fracción del vídeo que sonó (0..1) → escuchar entero puntúa ~1.
 *   - rescate (atrás → entera en modo clips): +1, la señal más fuerte de gusto.
 *   - en clips, escuchar bastante más que el propio clip indica interés extra.
 */
export function engagementScore(e: PlayHistoryEntry): number {
  const ratio = e.durationMs && e.listenedMs ? Math.min(e.listenedMs / e.durationMs, 1) : 0
  let score = ratio
  if (e.rescued) score += 1
  if (e.clipSeconds && e.listenedMs && e.listenedMs > e.clipSeconds * 1000 * 1.5) score += 0.5
  return score
}

export interface TasteSeed {
  artist: string
  title:  string
  score:  number   // suma del engagement de todas sus escuchas
}

/**
 * Agrega el historial por canción y devuelve las más "queridas" como semillas de
 * gusto, ordenadas por afinidad. `exclude` evita repetir las que ya son semilla
 * (p. ej. favoritos); `minScore` descarta los simples vistazos/saltos.
 */
export function aggregateTasteSeeds(
  history: PlayHistoryEntry[],
  opts: { exclude?: Set<string>; limit?: number; minScore?: number } = {}
): TasteSeed[] {
  const { exclude, limit = 8, minScore = 0.6 } = opts
  const byTrack = new Map<string, TasteSeed>()
  for (const e of history) {
    if (!e.artist || !e.title) continue
    const key = makeCacheKey(e.artist, e.title)
    if (exclude?.has(key)) continue
    const s = engagementScore(e)
    if (s <= 0) continue
    const cur = byTrack.get(key)
    if (cur) cur.score += s
    else byTrack.set(key, { artist: e.artist, title: e.title, score: s })
  }
  return [...byTrack.values()]
    .filter(t => t.score >= minScore)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
}
