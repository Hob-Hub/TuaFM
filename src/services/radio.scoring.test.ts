import { describe, it, expect } from 'vitest'
import { timeDecay, aggregateCandidates, weightedSample } from '@/services/radio.scoring'
import type { ChartPeriod, ChartSong, RadioCandidate } from '@/types/chart.types'

function song(partial: Partial<ChartSong> & Pick<ChartSong, 'artist' | 'title' | 'score'>): ChartSong {
  return {
    rank: 1, position: 1, peakPosition: 1, weeksOnChart: 1,
    artistDisplay: partial.artist.toUpperCase(), titleDisplay: partial.title.toUpperCase(),
    ...partial
  }
}
function period(year: number, songs: ChartSong[]): ChartPeriod {
  return { chartId: 'x', year, songs }
}

describe('timeDecay', () => {
  it('vale 1 en el propio año y decae con la distancia', () => {
    expect(timeDecay(0, 0.35)).toBe(1)
    expect(timeDecay(5, 0.35)).toBeLessThan(timeDecay(1, 0.35))
  })
  it('λ alto concentra en el año de referencia más que λ bajo', () => {
    expect(timeDecay(3, 1.0)).toBeLessThan(timeDecay(3, 0.1))
  })
})

describe('aggregateCandidates', () => {
  it('excluye años posteriores al de referencia', () => {
    const periods = [
      period(2010, [song({ artist: 'a', title: 't1', score: 5 })]),
      period(2011, [song({ artist: 'b', title: 't2', score: 5 })]) // futuro
    ]
    const res = aggregateCandidates(periods, 2010, 0.35)
    expect(res.map(c => c.artist)).toEqual(['a'])
  })

  it('acumula score y apariciones de una canción que reaparece en varios años', () => {
    const periods = [
      period(2008, [song({ artist: 'a', title: 't', score: 4 })]),
      period(2009, [song({ artist: 'a', title: 't', score: 6 })]),
      period(2010, [song({ artist: 'a', title: 't', score: 8 })])
    ]
    const res = aggregateCandidates(periods, 2010, 0.35)
    expect(res).toHaveLength(1)
    expect(res[0].appearances).toBe(3)
    expect(res[0].score).toBe(18)
    expect(res[0].weight).toBeGreaterThan(0)
  })

  it('el año de referencia pesa más que un año lejano con el mismo score', () => {
    const recent = aggregateCandidates([period(2010, [song({ artist: 'a', title: 't', score: 5 })])], 2010, 0.35)
    const old    = aggregateCandidates([period(2000, [song({ artist: 'a', title: 't', score: 5 })])], 2010, 0.35)
    expect(recent[0].weight).toBeGreaterThan(old[0].weight)
  })
})

describe('weightedSample', () => {
  const c = (artist: string, weight: number): RadioCandidate =>
    ({ artist, artistDisplay: artist, title: artist, titleDisplay: artist, weight, score: weight, appearances: 1 })

  it('nunca devuelve más que el tamaño del pool', () => {
    expect(weightedSample([c('a', 5), c('b', 3)], 10)).toHaveLength(2)
  })
  it('no repite candidatos (muestreo sin reemplazo)', () => {
    const pool = Array.from({ length: 5 }, (_, i) => c(`a${i}`, 1))
    expect(new Set(weightedSample(pool, 5).map(x => x.artist)).size).toBe(5)
  })
  it('devuelve vacío si todos los pesos son 0', () => {
    expect(weightedSample([c('a', 0)], 3)).toHaveLength(0)
  })
})
