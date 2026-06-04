export interface CsvRow {
  artist: string
  title:  string
  valid:  boolean
  line:   number
}

/**
 * Mapea filas crudas de CSV (artista, título) a CsvRow validadas. Detecta y
 * descarta una posible cabecera en la primera fila. Lógica pura, sin Papa Parse.
 */
export function mapCsvRows(data: string[][]): CsvRow[] {
  return data.map((cols, i) => {
    const artist = (cols[0] ?? '').trim()
    const title  = (cols[1] ?? '').trim()
    const isHeader = i === 0 &&
      /^(artist|artista)$/i.test(artist) &&
      /^(title|t[íi]tulo|song|canci[óo]n)$/i.test(title)
    return { artist, title, line: i + 1, valid: !isHeader && !!artist && !!title }
  }).filter(r => !(r.line === 1 && !r.valid && r.artist && r.title === ''))
}
