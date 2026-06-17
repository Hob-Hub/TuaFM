import { liveQuery } from 'dexie'
import { useObservable } from '@vueuse/rxjs'
import { from } from 'rxjs'
import { db, makeCacheKey } from '@/db/local.db'
import type { Track } from '@/types/track.types'
import type { QueueMode } from '@/types/queue.types'
import type { FailedTrack } from '@/types/playlist.types'

/**
 * Registro persistente de pistas que NO se pudieron reproducir (ningún candidato
 * de YouTube arrancó, o no se encontró vídeo). Sirve para revisarlas y arreglarlas
 * luego (mejor scoring de candidatos, IDs manuales…). Dedup por `cacheKey`: si la
 * misma pista vuelve a fallar, solo incrementa el contador en vez de duplicar.
 */

// ── Funciones puras (a nivel de módulo) ───────────────────────────────────────
// El orquestador y la recuperación de fallos solo necesitan REGISTRAR; importan
// `recordFailure` directamente para no abrir un liveQuery siempre vivo (corren
// dentro de usePlayback/usePlaybackRecovery, que viven toda la sesión). El
// observable lo crea solo la pantalla que lista los fallos (ver abajo).

export async function recordFailure(
  track: Track,
  reason: FailedTrack['reason'],
  triedVideoIds: string[],
  mode: QueueMode
): Promise<void> {
  if (!track.artist || !track.title) return
  if (mode === 'idle') return
  const cacheKey = makeCacheKey(track.artist, track.title)
  const now = Date.now()
  const prev = await db.failedTracks.get(cacheKey)
  await db.failedTracks.put({
    cacheKey,
    artist:        track.artist,
    title:         track.title,
    reason,
    triedVideoIds,
    queueMode:     mode,
    firstFailedAt: prev?.firstFailedAt ?? now,
    lastFailedAt:  now,
    count:         (prev?.count ?? 0) + 1
  })
}

export async function clearFailures(): Promise<void> {
  await db.failedTracks.clear()
}

export async function clearFailure(track: Pick<Track, 'artist' | 'title'>): Promise<void> {
  if (!track.artist || !track.title) return
  await db.failedTracks.delete(makeCacheKey(track.artist, track.title))
}

/** Vuelca el registro como JSON (para pegarlo/compartirlo y arreglarlo después). */
export async function exportFailures(): Promise<string> {
  const all = await db.failedTracks.orderBy('lastFailedAt').reverse().toArray()
  return JSON.stringify(all, null, 2)
}

/** Composable para la pantalla de "Pistas con problemas": aquí sí se abre el liveQuery. */
export function useFailedTracks() {
  const failures = useObservable<FailedTrack[], FailedTrack[]>(
    from(liveQuery(() =>
      db.failedTracks.orderBy('lastFailedAt').reverse().toArray()
    )),
    { initialValue: [] }
  )

  return { failures, recordFailure, clearFailures, exportFailures }
}
