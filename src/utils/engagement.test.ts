import { describe, it, expect } from 'vitest'
import { engagementScore, aggregateTasteSeeds } from '@/utils/engagement'
import type { PlayHistoryEntry } from '@/types/playlist.types'

function entry(p: Partial<PlayHistoryEntry>): PlayHistoryEntry {
  return {
    cacheKey: '', trackId: '', artist: 'A', title: 'T',
    queueMode: 'radio', playedAt: 0, ...p
  }
}

describe('engagementScore', () => {
  it('puntúa por fracción escuchada', () => {
    expect(engagementScore(entry({ listenedMs: 100_000, durationMs: 200_000 }))).toBeCloseTo(0.5)
    expect(engagementScore(entry({ listenedMs: 200_000, durationMs: 200_000 }))).toBeCloseTo(1)
  })

  it('un vistazo sin datos de duración puntúa 0', () => {
    expect(engagementScore(entry({ listenedMs: 5_000 }))).toBe(0)
  })

  it('el rescate (atrás → entera) es la señal más fuerte', () => {
    const full = engagementScore(entry({ listenedMs: 200_000, durationMs: 200_000 }))
    const rescued = engagementScore(entry({ listenedMs: 200_000, durationMs: 200_000, rescued: true }))
    expect(rescued).toBeGreaterThan(full)
  })

  it('en clips, escuchar mucho más que el clip suma interés', () => {
    // clip de 15s pero sonaron 60s → +0.5 sobre el ratio
    const s = engagementScore(entry({ listenedMs: 60_000, durationMs: 200_000, clipSeconds: 15 }))
    expect(s).toBeCloseTo(60_000 / 200_000 + 0.5)
  })
})

describe('aggregateTasteSeeds', () => {
  it('agrega por canción, ordena por afinidad y descarta los saltos', () => {
    const history = [
      entry({ artist: 'Querida', title: 'Mucho', listenedMs: 200_000, durationMs: 200_000, rescued: true }),
      entry({ artist: 'Querida', title: 'Mucho', listenedMs: 180_000, durationMs: 200_000 }),
      entry({ artist: 'Salto',   title: 'Poco',  listenedMs: 3_000,   durationMs: 200_000 }), // ~0.015 < minScore
      entry({ artist: 'Media',   title: 'Algo',  listenedMs: 140_000, durationMs: 200_000 }),
    ]
    const seeds = aggregateTasteSeeds(history)
    expect(seeds.map(s => s.title)).toEqual(['Mucho', 'Algo'])  // 'Poco' descartada
    expect(seeds[0].score).toBeGreaterThan(seeds[1].score)
  })

  it('excluye las que ya son semilla (favoritos)', () => {
    const history = [entry({ artist: 'Fav', title: 'Yes', listenedMs: 200_000, durationMs: 200_000 })]
    const seeds = aggregateTasteSeeds(history, { exclude: new Set(['fav::yes']) })
    expect(seeds).toHaveLength(0)
  })
})
