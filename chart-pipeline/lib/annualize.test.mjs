import { describe, expect, it } from 'vitest'
import { annualizeAnnual, annualizeWeekly } from './annualize.mjs'

const baseCfg = {
  chartId: 'it',
  artistSeparator: ';',
  dateField: 'chart_date',
  posField: 'position',
  titleField: 'title',
  artistField: 'artist_raw',
  coverField: 'cover_url'
}

describe('annualize cover fields', () => {
  it('carries coverField through annual sources', () => {
    const periods = annualizeAnnual([
      {
        chart_date: '2025-12-31',
        position: 1,
        title: 'Balorda Nostalgia',
        artist_raw: 'Olly',
        cover_url: 'https://media.fimi.it/folder/image.jpg'
      }
    ], baseCfg, 2025, 2025)

    expect(periods[0].songs[0].coverUrl).toBe('https://media.fimi.it/folder/image.jpg')
  })

  it('keeps the cover from the best weekly position', () => {
    const periods = annualizeWeekly([
      {
        chart_date: '2025-01-03',
        position: 10,
        title: 'Example',
        artist_raw: 'Artist',
        cover_url: 'https://media.fimi.it/folder/lower.jpg'
      },
      {
        chart_date: '2025-01-10',
        position: 2,
        title: 'Example',
        artist_raw: 'Artist',
        cover_url: 'https://media.fimi.it/folder/best.jpg'
      }
    ], baseCfg, 2025, 2025)

    expect(periods[0].songs[0].coverUrl).toBe('https://media.fimi.it/folder/best.jpg')
  })
})
