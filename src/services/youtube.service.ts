import { rankVideoCandidates, type YouTubeSearchItem } from '@/services/youtube.scoring'

const API_KEY = import.meta.env.VITE_YOUTUBE_API_KEY
const SEARCH  = 'https://www.googleapis.com/youtube/v3/search'

interface YouTubeSearchResponse {
  items?: YouTubeSearchItem[]
  error?: { code: number; message: string }
}

/**
 * Resuelve "artist title" a una lista de videoIds rankeada (mejor primero) vía
 * YouTube Data API v3. Devuelve [] si no hay resultados o si la cuota se agotó
 * (no lanza). Pide 5 resultados para poder reintentar otro candidato si el
 * primero no es reproducible en el iframe.
 *
 * Coste: 100 unidades por llamada → ~100 búsquedas/día en free tier. Por eso el
 * resultado (toda la lista) se cachea agresivamente en trackCache.service.
 */
export async function searchVideoCandidates(
  artist: string, title: string, signal?: AbortSignal
): Promise<string[]> {
  if (!API_KEY) {
    console.warn('[youtube] VITE_YOUTUBE_API_KEY no configurada')
    return []
  }

  const url = new URL(SEARCH)
  url.searchParams.set('part', 'snippet')
  url.searchParams.set('q', `${artist} ${title}`)
  url.searchParams.set('type', 'video')
  url.searchParams.set('videoEmbeddable', 'true')
  url.searchParams.set('maxResults', '5')
  url.searchParams.set('key', API_KEY)

  try {
    const res  = await fetch(url, { signal })
    const data = await res.json() as YouTubeSearchResponse
    if (data.error) {
      console.warn(`[youtube] API error ${data.error.code}: ${data.error.message}`)
      return []
    }
    return rankVideoCandidates(data.items ?? [], artist, title)
  } catch (err) {
    if ((err as Error).name === 'AbortError') throw err
    console.warn('[youtube] búsqueda fallida:', err)
    return []
  }
}

/**
 * Atajo: devuelve solo el mejor videoId (o null). Mantiene compatibilidad con
 * los llamadores que no necesitan la lista de candidatos.
 */
export async function searchVideoId(
  artist: string, title: string, signal?: AbortSignal
): Promise<string | null> {
  const candidates = await searchVideoCandidates(artist, title, signal)
  return candidates[0] ?? null
}
