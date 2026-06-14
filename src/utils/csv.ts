import Papa from 'papaparse'

export interface CsvRow {
  artist: string
  title:  string
  valid:  boolean
  line:   number
}

/**
 * Serializa pistas a CSV (artista, título) con cabecera, simétrico al import.
 * Lógica pura: devuelve el texto; la descarga la dispara quien llama.
 */
export function tracksToCsv(rows: { artist: string; title: string }[]): string {
  return Papa.unparse(
    { fields: ['artist', 'title'], data: rows.map(r => [r.artist, r.title]) },
    { quotes: true },
  )
}

/** Dispara la descarga de un texto como archivo en el navegador. */
export function downloadTextFile(filename: string, text: string, mime = 'text/csv'): void {
  const blob = new Blob([text], { type: `${mime};charset=utf-8` })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

/** Nombre de archivo seguro a partir del nombre de una playlist. */
export function safeFilename(name: string, ext: string): string {
  const base = name.trim().replace(/[^\p{L}\p{N}\-_ ]/gu, '').replace(/\s+/g, '-').slice(0, 60)
  return `${base || 'playlist'}.${ext}`
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
