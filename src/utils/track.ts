import { nanoid } from 'nanoid'
import type { Track } from '@/types/track.types'

/**
 * Crea un Track con `id` (nanoid) y `enriched: false` por defecto. Único sitio
 * que conoce esos valores por defecto, para no repetir el literal en cada origen
 * de pistas efímeras (Buscar, Top del año, candidatos de radio, recomendaciones).
 * Cualquier campo del parcial sobrescribe los valores por defecto.
 */
export function makeTrack(data: Partial<Track> & { artist: string; title: string }): Track {
  return { id: nanoid(), enriched: false, ...data }
}
