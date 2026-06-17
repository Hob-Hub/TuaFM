const API_BASE = 'https://api.deezer.com'

const memo = new Map<string, Promise<string | undefined>>()
const infoMemo = new Map<string, Promise<DeezerTrackInfo | undefined>>()

export interface DeezerTrackInfo {
  id?: number
  artist?: string
  title?: string
  album?: string
  coverUrl?: string
  durationMs?: number
  link?: string
}

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

const stripMarks = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
const tight = (value: string) => stripMarks(value).toLowerCase()
  .replace(/f\*+\s*k/g, 'fuck')
  .replace(/s\*+\s*t/g, 'shit')
  .replace(/p\*+\$\$y/g, 'pussy')
  .replace(/&/g, ' and ')
  .replace(/\$/g, 's')
  .replace(/!/g, 'i')
  .replace(/\/x\b/g, 'ix')
  .replace(/\bpt\b/g, 'part')
  .replace(/[^a-z0-9]+/g, '')
const primary = (value: string) => value.split(',')[0]?.trim() ?? ''
const titleBase = (value: string) => tight(value.replace(/\s*[\[(].*?[\])]\s*/g, ' '))

function compatibleText(query: string, result?: string): boolean {
  const q = tight(query)
  const r = tight(result ?? '')
  if (!q || !r) return false
  return q === r || (q.length >= 8 && r.includes(q)) || (r.length >= 8 && q.includes(r))
}

function compatibleArtist(query: string, result?: string): boolean {
  if (compatibleText(query, result)) return true
  const q = tight(query)
  const r = tight(result ?? '')
  return q.length >= 5 && r.length >= 5 && (q.includes(r) || r.includes(q))
}

function compatibleTitle(query: string, result?: string): boolean {
  if (compatibleText(query, result)) return true
  const q = titleBase(query)
  const r = tight(result ?? '')
  return q.length >= 4 && r.includes(q)
}

function isCompatibleTrack(queryArtist: string, queryTitle: string, track: {
  artist?: { name?: string }
  title?: string
  title_short?: string
}): boolean {
  return compatibleArtist(primary(queryArtist), track.artist?.name)
    && compatibleTitle(queryTitle, track.title_short || track.title)
}

type DeezerSearchTrack = {
  id?: number
  title?: string
  title_short?: string
  duration?: number
  link?: string
  artist?: { name?: string }
  album?: { title?: string; cover_xl?: string; cover_big?: string; cover_medium?: string }
}

function toTrackInfo(track: DeezerSearchTrack): DeezerTrackInfo {
  const coverUrl = track.album?.cover_xl || track.album?.cover_big || track.album?.cover_medium
  return {
    id: track.id,
    artist: track.artist?.name,
    title: track.title_short || track.title,
    album: track.album?.title,
    coverUrl: isDeezerImageUrl(coverUrl) ? coverUrl : undefined,
    durationMs: track.duration ? Number(track.duration) * 1000 : undefined,
    link: track.link
  }
}

async function searchTrackInfo(
  artist: string,
  title: string,
  query: string,
  signal?: AbortSignal
): Promise<DeezerTrackInfo | undefined> {
  return fetch(`${API_BASE}/search?limit=5&q=${encodeURIComponent(query)}`, { signal })
    .then(async res => (res.ok ? res.json() : undefined))
    .then(body => {
      const data = body as { data?: DeezerSearchTrack[] } | undefined
      const track = data?.data?.find(item => isCompatibleTrack(artist, title, item))
      return track ? toTrackInfo(track) : undefined
    })
    .catch(() => undefined)
}

export function getDeezerTrackInfo(
  artist: string,
  title: string,
  signal?: AbortSignal
): Promise<DeezerTrackInfo | undefined> {
  const q = `artist:"${artist}" track:"${title}"`
  const key = `track-info:${artist.toLowerCase()}::${title.toLowerCase()}`
  let hit = infoMemo.get(key)
  if (!hit) {
    hit = searchTrackInfo(artist, title, q, signal)
      .then(info => info ?? searchTrackInfo(artist, title, `${artist} ${title}`, signal))
    infoMemo.set(key, hit)
  }
  return hit
}

export function getDeezerTrackCover(
  artist: string,
  title: string,
  signal?: AbortSignal
): Promise<string | undefined> {
  return getDeezerTrackInfo(artist, title, signal).then(info => info?.coverUrl)
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
