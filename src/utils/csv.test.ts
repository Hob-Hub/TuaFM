import { describe, it, expect } from 'vitest'
import { mapCsvRows, tracksToCsv, safeFilename } from '@/utils/csv'

describe('mapCsvRows', () => {
  it('mapea filas artista,título válidas', () => {
    const rows = mapCsvRows([['Radiohead', 'Creep'], ['Oasis', 'Wonderwall']])
    expect(rows).toHaveLength(2)
    expect(rows[0]).toMatchObject({ artist: 'Radiohead', title: 'Creep', valid: true, line: 1 })
  })

  it('descarta una cabecera "artist,title"', () => {
    const rows = mapCsvRows([['artist', 'title'], ['Oasis', 'Wonderwall']])
    expect(rows[0].valid).toBe(false)
    expect(rows[1].valid).toBe(true)
  })

  it('detecta cabecera en español', () => {
    const rows = mapCsvRows([['Artista', 'Canción'], ['Oasis', 'Wonderwall']])
    expect(rows[0].valid).toBe(false)
  })

  it('marca inválidas las filas incompletas', () => {
    const rows = mapCsvRows([['Solo Artista', ''], ['', 'Solo Título']])
    expect(rows.every(r => !r.valid)).toBe(true)
  })

  it('recorta espacios', () => {
    const rows = mapCsvRows([['  Radiohead  ', '  Creep  ']])
    expect(rows[0]).toMatchObject({ artist: 'Radiohead', title: 'Creep' })
  })
})

describe('tracksToCsv', () => {
  it('serializa con cabecera artist,title', () => {
    const csv = tracksToCsv([{ artist: 'Oasis', title: 'Wonderwall' }])
    const lines = csv.split(/\r?\n/)
    expect(lines[0]).toBe('"artist","title"')
    expect(lines[1]).toBe('"Oasis","Wonderwall"')
  })

  it('hace round-trip con mapCsvRows (saltando la cabecera)', () => {
    const original = [{ artist: 'Radiohead', title: 'Creep' }, { artist: 'Oasis', title: 'Wonderwall' }]
    const csv = tracksToCsv(original)
    const back = mapCsvRows(csv.split(/\r?\n/).map(l => l.replace(/^"|"$/g, '').split('","')))
      .filter(r => r.valid)
      .map(({ artist, title }) => ({ artist, title }))
    expect(back).toEqual(original)
  })
})

describe('safeFilename', () => {
  it('sanea y añade extensión', () => {
    expect(safeFilename('Veranos / 2000s!', 'csv')).toBe('Veranos-2000s.csv')
  })
  it('cae a un nombre por defecto si queda vacío', () => {
    expect(safeFilename('///', 'csv')).toBe('playlist.csv')
  })
})
