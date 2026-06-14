import { liveQuery } from 'dexie'
import { useObservable } from '@vueuse/rxjs'
import { from } from 'rxjs'
import { db, makeCacheKey } from '@/db/local.db'
import type { Track } from '@/types/track.types'
import type { QueueMode } from '@/types/queue.types'
import type { PlayHistoryEntry } from '@/types/playlist.types'

export function usePlayHistory() {
  // Últimas 200 reproducciones, más recientes primero
  const history = useObservable<PlayHistoryEntry[], PlayHistoryEntry[]>(
    from(liveQuery(() =>
      db.history.orderBy('playedAt').reverse().limit(200).toArray()
    )),
    { initialValue: [] }
  )

  /** Registra el ARRANQUE de una pista y devuelve el id de la entrada, para
   *  completarla luego con las señales de escucha (ver `updateEngagement`). */
  async function recordPlay(track: Track, mode: QueueMode): Promise<number | undefined> {
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
  async function updateEngagement(id: number, data: Partial<PlayHistoryEntry>): Promise<void> {
    await db.history.update(id, data)
  }

  async function clearHistory(): Promise<void> {
    await db.history.clear()
  }

  return { history, recordPlay, updateEngagement, clearHistory }
}
