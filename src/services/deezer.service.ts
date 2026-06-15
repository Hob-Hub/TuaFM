const API_BASE = 'https://api.deezer.com'

const memo = new Map<string, Promise<string | undefined>>()

export function isDeezerImageUrl(url?: string): boolean {
  if (!url) return false
  try {
    const host = new URL(url).hostname.toLowerCase()
    return host === 'cdn-images.dzcdn.net' || host.endsWith('.dzcdn.net')
  } catch {
    return false
  }
}

async function searchImage(
  key: string,
  url: string,
  pick: (body: unknown) => string | undefined,
  signal?: AbortSignal
): Promise<string | undefined> {
  let hit = memo.get(key)
  if (!hit) {
    hit = fetch(url, { signal })
      .then(async res => (res.ok ? pick(await res.json()) : undefined))
      .then(image => (isDeezerImageUrl(image) ? image : undefined))
      .catch(() => undefined)
    memo.set(key, hit)
  }
  return hit
}

export function getDeezerTrackCover(
  artist: string,
  title: string,
  signal?: AbortSignal
): Promise<string | undefined> {
  const q = `artist:"${artist}" track:"${title}"`
  const key = `track:${artist.toLowerCase()}::${title.toLowerCase()}`
  return searchImage(
    key,
    `${API_BASE}/search?limit=1&q=${encodeURIComponent(q)}`,
    body => {
      const data = body as { data?: Array<{ album?: { cover_xl?: string; cover_big?: string; cover_medium?: string } }> }
      const album = data.data?.[0]?.album
      return album?.cover_xl || album?.cover_big || album?.cover_medium
    },
    signal
  )
}

export function getDeezerArtistImage(name: string, signal?: AbortSignal): Promise<string | undefined> {
  const key = `artist:${name.toLowerCase()}`
  return searchImage(
    key,
    `${API_BASE}/search/artist?limit=1&q=${encodeURIComponent(name)}`,
    body => {
      const data = body as { data?: Array<{ picture_xl?: string; picture_big?: string; picture_medium?: string }> }
      const artist = data.data?.[0]
      return artist?.picture_xl || artist?.picture_big || artist?.picture_medium
    },
    signal
  )
}
