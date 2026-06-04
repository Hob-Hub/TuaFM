import { ref } from 'vue'
import Papa from 'papaparse'
import { nanoid } from 'nanoid'
import type { Track } from '@/types/track.types'
import { mapCsvRows, type CsvRow } from '@/utils/csv'

export type { CsvRow }

/**
 * Importación CSV: dos columnas (artista, título), sin cabecera obligatoria.
 * Parsea, valida fila a fila y produce tracks no enriquecidos (lazy).
 */
export function useCsvImport() {
  const rows    = ref<CsvRow[]>([])
  const parsing = ref(false)
  const error   = ref<string | null>(null)

  function parseFile(file: File): Promise<CsvRow[]> {
    parsing.value = true
    error.value   = null
    rows.value    = []

    return new Promise((resolve) => {
      Papa.parse<string[]>(file, {
        skipEmptyLines: 'greedy',
        complete: (results) => {
          rows.value = mapCsvRows(results.data)
          parsing.value = false
          resolve(rows.value)
        },
        error: (err: Error) => {
          error.value = err.message
          parsing.value = false
          resolve([])
        }
      })
    })
  }

  function parseText(text: string): CsvRow[] {
    error.value = null
    const results = Papa.parse<string[]>(text, { skipEmptyLines: 'greedy' })
    rows.value = mapCsvRows(results.data)
    return rows.value
  }

  function toTracks(validRows: CsvRow[]): Track[] {
    return validRows
      .filter(r => r.valid)
      .map(r => ({
        id: nanoid(), artist: r.artist, title: r.title, enriched: false
      }))
  }

  return { rows, parsing, error, parseFile, parseText, toTracks }
}
