import { liveQuery } from 'dexie'
import { useObservable } from '@vueuse/rxjs'
import { from } from 'rxjs'
import { db, makeCacheKey } from '@/db/local.db'
import type { Track } from '@/types/track.types'
import type { FavoriteTrack } from '@/types/playlist.types'

export function useFavorites() {
  const favorites = useObservable<FavoriteTrack[], FavoriteTrack[]>(
    from(liveQuery(() => db.favorites.orderBy('addedAt').reverse().toArray())),
    { initialValue: [] }
  )

  async function addFavorite(track: Track): Promise<void> {
    const cacheKey = makeCacheKey(track.artist, track.title)
    await db.favorites.put({
      cacheKey, artist: track.artist, title: track.title,
      coverUrl: track.coverUrl, addedAt: Date.now()
    })
  }

  async function removeFavorite(artist: string, title: string): Promise<void> {
    await db.favorites.delete(makeCacheKey(artist, title))
  }

  async function toggleFavorite(track: Track): Promise<boolean> {
    const key = makeCacheKey(track.artist, track.title)
    const existing = await db.favorites.get(key)
    if (existing) { await db.favorites.delete(key); return false }
    await addFavorite(track)
    return true
  }

  async function isFavorite(artist: string, title: string): Promise<boolean> {
    return !!(await db.favorites.get(makeCacheKey(artist, title)))
  }

  return { favorites, addFavorite, removeFavorite, toggleFavorite, isFavorite }
}
