import { describe, it, expect } from 'vitest'
import { mapCsvRows } from '@/utils/csv'

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
