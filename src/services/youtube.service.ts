const API_KEY = import.meta.env.VITE_YOUTUBE_API_KEY
const SEARCH  = 'https://www.googleapis.com/youtube/v3/search'

interface YouTubeSearchResponse {
  items?: Array<{ id?: { videoId?: string } }>
  error?: { code: number; message: string }
}

/**
 * Busca el videoId más relevante para "artist title" vía YouTube Data API v3.
 * Devuelve null si no hay resultado o si la cuota está agotada (no lanza:
 * el modo radio precarga videoId, así que esto solo se usa en playlist/recs).
 *
 * Cada llamada cuesta 100 unidades de cuota → ~100 búsquedas/día en free tier.
 * Por eso el resultado se cachea agresivamente en trackCache.service.
 */
export async function searchVideoId(
  artist: string, title: string, signal?: AbortSignal
): Promise<string | null> {
  if (!API_KEY) {
    console.warn('[youtube] VITE_YOUTUBE_API_KEY no configurada')
    return null
  }

  const url = new URL(SEARCH)
  url.searchParams.set('part', 'snippet')
  url.searchParams.set('q', `${artist} ${title}`)
  url.searchParams.set('type', 'video')
  url.searchParams.set('videoEmbeddable', 'true')
  url.searchParams.set('maxResults', '1')
  url.searchParams.set('key', API_KEY)

  try {
    const res  = await fetch(url, { signal })
    const data = await res.json() as YouTubeSearchResponse
    if (data.error) {
      console.warn(`[youtube] API error ${data.error.code}: ${data.error.message}`)
      return null
    }
    return data.items?.[0]?.id?.videoId ?? null
  } catch (err) {
    if ((err as Error).name === 'AbortError') throw err
    console.warn('[youtube] búsqueda fallida:', err)
    return null
  }
}
