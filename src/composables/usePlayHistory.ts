import { liveQuery } from 'dexie'
import { useObservable } from '@vueuse/rxjs'
import { from } from 'rxjs'
import { db, makeCacheKey } from '@/db/local.db'
import type { Track } from '@/types/track.types'
import type { QueueMode } from '@/types/queue.types'
import type { PlayHistoryEntry } from '@/types/playlist.types'
import { aggregateTasteSeeds } from '@/utils/engagement'

// ── Funciones puras (a nivel de módulo, no dentro del composable) ─────────────
// Quien solo necesita ESCRIBIR/consultar (el orquestador de reproducción, las
// recomendaciones…) las importa directamente y NO abre la suscripción liveQuery.
// El camino caliente escribe en cada transición de pista: si arrastrara el
// observable, cada reproducción mantendría viva una re-query reactiva del
// historial sin usarla. El observable solo lo crea quien lo pinta (ver abajo).

/** Registra el ARRANQUE de una pista y devuelve el id de la entrada, para
 *  completarla luego con las señales de escucha (ver `updateEngagement`). */
export async function recordPlay(track: Track, mode: QueueMode): Promise<number | undefined> {
  if (!track.artist || !track.title) return undefined
  if (mode === 'idle') return undefined
  return db.history.add({
    cacheKey:  makeCacheKey(track.artist, track.title),
    trackId:   track.id,
    artist:    track.artist,
    title:     track.title,
    coverUrl:  track.coverUrl,
    queueMode: mode,
    playedAt:  Date.now()
  })
}

/** Completa una entrada con las señales de escucha al SALIR de la pista
 *  (cuánto se escuchó de verdad, si se rescató en modo clips…). */
export async function updateEngagement(id: number, data: Partial<PlayHistoryEntry>): Promise<void> {
  await db.history.update(id, data)
}

/**
 * Canciones más escuchadas (por engagement) para sembrar las recomendaciones
 * con el comportamiento real, no solo con los favoritos. `exclude` evita repetir
 * las que ya son semilla. Mira un histórico amplio, no solo las 200 visibles.
 */
export async function getEngagementSeeds(limit = 8, exclude?: Set<string>): Promise<{ artist: string; title: string }[]> {
  const recent = await db.history.orderBy('playedAt').reverse().limit(500).toArray()
  return aggregateTasteSeeds(recent, { exclude, limit }).map(t => ({ artist: t.artist, title: t.title }))
}

export async function clearHistory(): Promise<void> {
  await db.history.clear()
}

/** Composable para la UI que PINTA el historial: aquí sí se abre el liveQuery. */
export function usePlayHistory() {
  // Últimas 200 reproducciones, más recientes primero
  const history = useObservable<PlayHistoryEntry[], PlayHistoryEntry[]>(
    from(liveQuery(() =>
      db.history.orderBy('playedAt').reverse().limit(200).toArray()
    )),
    { initialValue: [] }
  )

  return { history, recordPlay, updateEngagement, getEngagementSeeds, clearHistory }
}
