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

  async function recordPlay(track: Track, mode: QueueMode): Promise<void> {
    if (!track.artist || !track.title) return
    if (mode === 'idle') return
    await db.history.add({
      cacheKey:  makeCacheKey(track.artist, track.title),
      trackId:   track.id,
      artist:    track.artist,
      title:     track.title,
      coverUrl:  track.coverUrl,
      queueMode: mode,
      playedAt:  Date.now()
    })
  }

  async function clearHistory(): Promise<void> {
    await db.history.clear()
  }

  return { history, recordPlay, clearHistory }
}
