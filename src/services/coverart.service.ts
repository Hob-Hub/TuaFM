// Fallback de carátulas cuando Last.fm no tiene imagen: MusicBrainz localiza
// la release (release-group) y Cover Art Archive sirve la portada front.
// Ambos servicios son gratuitos y sin clave. MusicBrainz pide un User-Agent
// identificable y un rate-limit de ~1 req/s; aquí cacheamos en memoria por
// sesión para no repetir y respetamos un único hit por (artist, album).

const MB_BASE = 'https://musicbrainz.org/ws/2'
const CAA     = 'https://coverartarchive.org'

interface MbReleaseGroupResponse {
  'release-groups'?: Array<{ id: string; 'primary-type'?: string }>
}

const memoCache = new Map<string, string | null>()

export async function getCoverUrl(
  artist: string, album: string, signal?: AbortSignal
): Promise<string | null> {
  const key = `${artist.toLowerCase()}::${album.toLowerCase()}`
  if (memoCache.has(key)) return memoCache.get(key) ?? null

  const result = await resolveCover(artist, album, signal).catch(() => null)
  memoCache.set(key, result)
  return result
}

async function resolveCover(
  artist: string, album: string, signal?: AbortSignal
): Promise<string | null> {
  const q   = `releasegroup:"${album}" AND artist:"${artist}"`
  const url = `${MB_BASE}/release-group?query=${encodeURIComponent(q)}&fmt=json&limit=1`

  const res = await fetch(url, {
    signal,
    headers: { Accept: 'application/json' }
  })
  if (!res.ok) return null

  const data = await res.json() as MbReleaseGroupResponse
  const rg   = data['release-groups']?.[0]
  if (!rg) return null

  // Cover Art Archive redirige a la imagen front-500 si existe.
  const caaUrl = `${CAA}/release-group/${rg.id}/front-500`
  const head   = await fetch(caaUrl, { method: 'HEAD', signal }).catch(() => null)
  return head && head.ok ? caaUrl : null
}
