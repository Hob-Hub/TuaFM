import { describe, it, expect } from 'vitest'
import {
  toAbsWeek, positionScore, timeDecay, persistenceScore,
  aggregateCandidates, weightedSample
} from '@/services/radio.scoring'
import type { ChartPeriod, RadioCandidate } from '@/types/chart.types'

describe('funciones de scoring', () => {
  it('toAbsWeek no colisiona entre años con semana 53', () => {
    expect(toAbsWeek(2020, 53)).toBeLessThan(toAbsWeek(2021, 1))
  })
  it('positionScore: el nº1 pesa más que el nº40', () => {
    expect(positionScore(1)).toBeGreaterThan(positionScore(40))
    expect(positionScore(1)).toBeCloseTo(1)
  })
  it('timeDecay decae con las semanas y es 1 en la semana 0', () => {
    expect(timeDecay(0, 0.008)).toBe(1)
    expect(timeDecay(100, 0.008)).toBeLessThan(timeDecay(10, 0.008))
  })
  it('persistenceScore crece con las semanas en lista', () => {
    expect(persistenceScore(20)).toBeGreaterThan(persistenceScore(2))
  })
})

function period(year: number, week: number, songs: ChartPeriod['songs']): ChartPeriod {
  return { chartId: 'x', periodType: 'weekly', year, week, effectiveWeek: week, isoDate: '', songs }
}

describe('aggregateCandidates', () => {
  it('excluye periodos posteriores a la referencia', () => {
    const periods = [
      period(2010, 30, [{ position: 1, artist: 'a', artistDisplay: 'A', title: 't1' }]),
      period(2010, 35, [{ position: 1, artist: 'b', artistDisplay: 'B', title: 't2' }]) // futuro
    ]
    const res = aggregateCandidates(periods, 2010, 30, 0.008)
    expect(res.map(c => c.artist)).toEqual(['a'])
  })

  it('acumula apariciones y guarda el máximo de semanas en lista', () => {
    const periods = [
      period(2010, 28, [{ position: 5, artist: 'a', artistDisplay: 'A', title: 't', weeksInList: 3 }]),
      period(2010, 29, [{ position: 3, artist: 'a', artistDisplay: 'A', title: 't', weeksInList: 8 }]),
      period(2010, 30, [{ position: 1, artist: 'a', artistDisplay: 'A', title: 't', weeksInList: 9 }])
    ]
    const res = aggregateCandidates(periods, 2010, 30, 0.008)
    expect(res).toHaveLength(1)
    expect(res[0].appearances).toBe(3)
    expect(res[0].maxWeeksInList).toBe(9)
    expect(res[0].weight).toBeGreaterThan(0)
  })
})

describe('weightedSample', () => {
  it('nunca devuelve más que el tamaño del pool', () => {
    const pool: RadioCandidate[] = [
      { artist: 'a', artistDisplay: 'A', title: '1', weight: 5, appearances: 1, maxWeeksInList: 1 },
      { artist: 'b', artistDisplay: 'B', title: '2', weight: 3, appearances: 1, maxWeeksInList: 1 }
    ]
    expect(weightedSample(pool, 10)).toHaveLength(2)
  })

  it('no repite candidatos (muestreo sin reemplazo)', () => {
    const pool: RadioCandidate[] = Array.from({ length: 5 }, (_, i) => ({
      artist: `a${i}`, artistDisplay: `A${i}`, title: `${i}`, weight: 1, appearances: 1, maxWeeksInList: 1
    }))
    const sample = weightedSample(pool, 5)
    expect(new Set(sample.map(c => c.artist)).size).toBe(5)
  })

  it('devuelve vacío si todos los pesos son 0', () => {
    const pool: RadioCandidate[] = [
      { artist: 'a', artistDisplay: 'A', title: '1', weight: 0, appearances: 1, maxWeeksInList: 1 }
    ]
    expect(weightedSample(pool, 3)).toHaveLength(0)
  })
})
