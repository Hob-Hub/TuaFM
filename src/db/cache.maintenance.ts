// Mantenimiento de las cachés de Dexie. Aislado de local.db (esquema) y de
// cache.helpers (puro) porque aquí sí hay I/O sobre IndexedDB.

import { db } from './local.db'
import { TTL_TRACK_DAYS, TTL_ARTIST_DAYS, TTL_COVER_DAYS, TTL_SIMILARITY_DAYS } from './cache.helpers'

const DAY_MS = 86_400_000

/**
 * Borra las entradas de caché que superaron su TTL. Acota el crecimiento de
 * IndexedDB: los stores de caché solo crecían, porque una entrada caducada que
 * no se vuelve a consultar se quedaba para siempre. Cada store se barre por su
 * propio TTL (índice `localCachedAt`, así que la consulta es eficiente).
 *
 * Los stores de USUARIO (playlists, favorites, history) NO se tocan: no son
 * caché. Pensado para llamarse una vez al arrancar, en segundo plano.
 *
 * @returns nº total de entradas borradas
 */
export async function pruneExpiredCaches(now: number = Date.now()): Promise<number> {
  const cutoff = (ttlDays: number) => now - ttlDays * DAY_MS
  const deleted = await Promise.all([
    db.tracks.where('localCachedAt').below(cutoff(TTL_TRACK_DAYS)).delete(),
    db.artists.where('localCachedAt').below(cutoff(TTL_ARTIST_DAYS)).delete(),
    db.covers.where('localCachedAt').below(cutoff(TTL_COVER_DAYS)).delete(),
    db.lastfmCache.where('localCachedAt').below(cutoff(TTL_SIMILARITY_DAYS)).delete()
  ])
  return deleted.reduce((a, b) => a + b, 0)
}

/**
 * Vacía por completo las cachés (tracks, artistas, carátulas, grafo Last.fm) y,
 * además, la caché de imágenes del Service Worker (`tuafm-artwork`). Esta última
 * es clave: el SW guarda las carátulas en CacheStorage y, si una respuesta llegó
 * rota/opaca, se servía indefinidamente — así que sin purgarla "Borrar caché" no
 * recuperaba carátulas atascadas. NO toca los stores de usuario (playlists,
 * favorites, history).
 *
 * @returns nº total de entradas borradas (Dexie)
 */
export async function clearAllCaches(): Promise<number> {
  const counts = await Promise.all([
    db.tracks.count(), db.artists.count(), db.covers.count(), db.lastfmCache.count()
  ])
  await Promise.all([
    db.tracks.clear(), db.artists.clear(), db.covers.clear(), db.lastfmCache.clear()
  ])
  await clearArtworkCache()
  return counts.reduce((a, b) => a + b, 0)
}

/** Borra la CacheStorage de carátulas del Service Worker (best-effort: no existe
 *  en dev ni en navegadores sin SW). El nombre coincide con el runtimeCaching de
 *  vite.config.ts; filtramos por substring por si Workbox lo prefija. */
async function clearArtworkCache(): Promise<void> {
  try {
    if (typeof caches === 'undefined') return
    const keys = await caches.keys()
    await Promise.all(
      keys.filter(k => k.includes('tuafm-artwork')).map(k => caches.delete(k))
    )
  } catch { /* CacheStorage no disponible */ }
}
