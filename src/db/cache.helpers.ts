// Helpers puros (sin I/O) para las cachés persistentes de Dexie. Aislados para
// poder testarlos sin IndexedDB.

const DAY_MS = 86_400_000

/** ¿La entrada cacheada en `cachedAt` superó su TTL en días? */
export function isExpired(cachedAt: number, ttlDays: number, now: number = Date.now()): boolean {
  return now - cachedAt > ttlDays * DAY_MS
}

/**
 * Clave estable para cachear una respuesta de Last.fm por método + argumentos.
 * Los valores se normalizan a minúsculas y se ordenan las claves para que el
 * mismo lookup produzca siempre la misma clave (independiente del orden).
 */
export function makeLastfmCacheKey(method: string, params: Record<string, string | number>): string {
  const parts = Object.keys(params)
    .sort()
    .map(k => `${k}=${String(params[k]).toLowerCase().trim()}`)
  return `${method}|${parts.join('&')}`
}

// TTLs por tipo de dato (en días). La info de catálogo/similitud apenas cambia;
// las carátulas, prácticamente nunca.
export const TTL_ARTIST_DAYS = 30
export const TTL_COVER_DAYS = 90
export const TTL_SIMILARITY_DAYS = 30
