import { liveQuery } from 'dexie'
import { useObservable } from '@vueuse/rxjs'
import { from } from 'rxjs'
import { nanoid } from 'nanoid'
import { db, makeCacheKey } from '@/db/local.db'
import type { Playlist } from '@/types/playlist.types'
import type { Track } from '@/types/track.types'
import type { LocalTrack } from '@/db/local.db'

export function usePlaylists() {
  // Lista reactiva de todas las playlists (para sidebar y home)
  const playlists = useObservable<Playlist[], Playlist[]>(
    from(liveQuery(() => db.playlists.orderBy('updatedAt').reverse().toArray())),
    { initialValue: [] }
  )

  async function createPlaylist(name: string, description?: string): Promise<string> {
    const id  = nanoid()
    const now = Date.now()
    await db.playlists.add({
      id, name: name.trim() || 'Sin título', description,
      trackIds: [], createdAt: now, updatedAt: now
    })
    return id
  }

  async function renamePlaylist(id: string, name: string): Promise<void> {
    await db.playlists.update(id, { name: name.trim(), updatedAt: Date.now() })
  }

  async function deletePlaylist(id: string): Promise<void> {
    // No borramos los tracks: la tabla tracks es también caché compartida.
    await db.playlists.delete(id)
  }

  /** Normaliza un Track a su forma persistible en Dexie (PK + cacheKey + sello). */
  function toLocalTrack(track: Track): LocalTrack {
    return {
      ...track,
      id:            track.id || nanoid(),
      cacheKey:      makeCacheKey(track.artist, track.title),
      enriched:      track.enriched ?? false,
      localCachedAt: Date.now()
    }
  }

  /** Persiste tracks en Dexie y los añade a la playlist (los repetidos no se duplican). */
  async function addTracks(playlistId: string, tracks: Track[]): Promise<void> {
    const pl = await db.playlists.get(playlistId)
    if (!pl) return
    const ids = [...pl.trackIds]
    for (const track of tracks) {
      const local = toLocalTrack(track)
      await db.tracks.put(local)
      if (!ids.includes(local.id)) ids.push(local.id)
    }
    // Refrescamos siempre el track; la lista de la playlist solo si cambió.
    if (ids.length !== pl.trackIds.length) {
      await db.playlists.update(playlistId, { trackIds: ids, updatedAt: Date.now() })
    }
  }

  /** Persiste un track en Dexie (si hace falta) y lo añade a la playlist. */
  async function addTrack(playlistId: string, track: Track): Promise<void> {
    await addTracks(playlistId, [track])
  }

  async function removeTrackAt(playlistId: string, index: number): Promise<void> {
    const pl = await db.playlists.get(playlistId)
    if (!pl) return
    pl.trackIds.splice(index, 1)
    await db.playlists.update(playlistId, { trackIds: pl.trackIds, updatedAt: Date.now() })
  }

  async function reorderTracks(playlistId: string, newOrder: string[]): Promise<void> {
    await db.playlists.update(playlistId, { trackIds: newOrder, updatedAt: Date.now() })
  }

  /** Actualiza un track ya persistido (p.ej. tras enriquecimiento lazy). */
  async function updateTrack(trackId: string, data: Partial<Track>): Promise<void> {
    await db.tracks.update(trackId, data)
  }

  async function getPlaylist(id: string): Promise<Playlist | undefined> {
    return db.playlists.get(id)
  }

  /** Devuelve los tracks de una playlist en su orden de trackIds. */
  async function getTracks(playlist: Playlist): Promise<Track[]> {
    const rows = await db.tracks.bulkGet(playlist.trackIds)
    return playlist.trackIds
      .map((_, i) => rows[i])
      .filter((t): t is LocalTrack => !!t)
  }

  /** Observable reactivo de una playlist y sus tracks ordenados (para el detalle). */
  function observePlaylistDetail(playlistId: string) {
    type Detail = { playlist: Playlist | null; tracks: Track[] }
    return useObservable<Detail, Detail>(
      from(liveQuery(async () => {
        const pl = await db.playlists.get(playlistId)
        if (!pl) return { playlist: null, tracks: [] }
        const rows = await db.tracks.bulkGet(pl.trackIds)
        const tracks = pl.trackIds
          .map((_, i) => rows[i])
          .filter((t): t is LocalTrack => !!t)
        return { playlist: pl, tracks }
      })),
      { initialValue: { playlist: null, tracks: [] } }
    )
  }

  return {
    playlists,
    createPlaylist, renamePlaylist, deletePlaylist,
    addTrack, addTracks, removeTrackAt, reorderTracks, updateTrack,
    getPlaylist, getTracks, observePlaylistDetail
  }
}
