// Scoring puro de resultados de YouTube, extraído para poder testearlo sin red.

export interface YouTubeSearchItem {
  id?:      { videoId?: string }
  snippet?: { title?: string; channelTitle?: string }
}

/**
 * Puntúa un resultado de YouTube para "artist title". Premia coincidencias de
 * artista/título y señales de versión oficial; penaliza covers, karaokes y
 * variantes (remix/live) que no se pidieron explícitamente.
 */
export function scoreCandidate(
  item: YouTubeSearchItem, artistNorm: string, titleNorm: string
): number {
  const title   = (item.snippet?.title ?? '').toLowerCase()
  const channel = (item.snippet?.channelTitle ?? '').toLowerCase()
  if (!title) return 0

  let score = 0
  if (artistNorm && (title.includes(artistNorm) || channel.includes(artistNorm))) score += 3
  if (titleNorm && title.includes(titleNorm)) score += 3
  if (/official\s*(audio|video|music)/.test(title)) score += 2
  if (channel.includes('topic') || channel.includes('official')) score += 2
  if (/lyric/.test(title)) score += 1

  if (/\b(cover|karaoke|tribute|8d|sped up|nightcore)\b/.test(title)) score -= 4
  if (/\bremix\b/.test(title) && !titleNorm.includes('remix')) score -= 3
  if (/\blive\b/.test(title)  && !titleNorm.includes('live'))  score -= 2
  if (/\b(reaction|instrumental)\b/.test(title)) score -= 2

  return score
}

/**
 * Ordena los resultados de búsqueda de mejor a peor y devuelve solo los
 * videoIds. Estable: ante empate respeta el orden original de la API.
 */
export function rankVideoCandidates(
  items: YouTubeSearchItem[], artist: string, title: string
): string[] {
  const artistNorm = artist.toLowerCase().trim()
  const titleNorm  = title.toLowerCase().trim()

  return items
    .map((item, i) => ({ id: item.id?.videoId, i, score: scoreCandidate(item, artistNorm, titleNorm) }))
    .filter((c): c is { id: string; i: number; score: number } => !!c.id)
    .sort((a, b) => b.score - a.score || a.i - b.i)
    .map(c => c.id)
}
