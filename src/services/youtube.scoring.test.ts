import { describe, it, expect } from 'vitest'
import { scoreCandidate, rankVideoCandidates, type YouTubeSearchItem } from './youtube.scoring'

const item = (title: string, channelTitle = '', videoId = title): YouTubeSearchItem => ({
  id: { videoId },
  snippet: { title, channelTitle }
})

describe('scoreCandidate', () => {
  it('premia coincidencia de artista y título', () => {
    const s = scoreCandidate(item('Radiohead - Creep'), 'radiohead', 'creep')
    expect(s).toBeGreaterThan(0)
  })

  it('premia el canal "Topic" oficial', () => {
    const withTopic = scoreCandidate(item('Creep', 'Radiohead - Topic'), 'radiohead', 'creep')
    const plain     = scoreCandidate(item('Creep', 'random channel'), 'radiohead', 'creep')
    expect(withTopic).toBeGreaterThan(plain)
  })

  it('penaliza covers y karaokes', () => {
    const cover = scoreCandidate(item('Creep (karaoke version)'), 'radiohead', 'creep')
    expect(cover).toBeLessThan(0)
  })

  it('no penaliza "remix" si la canción pedida ya lo incluye', () => {
    const wanted   = scoreCandidate(item('Song Title (Club Remix)'), 'artist', 'song title (club remix)')
    const unwanted = scoreCandidate(item('Song Title (Club Remix)'), 'artist', 'song title')
    expect(wanted).toBeGreaterThan(unwanted)
  })

  it('devuelve 0 si no hay título', () => {
    expect(scoreCandidate({ id: { videoId: 'x' } }, 'a', 'b')).toBe(0)
  })
})

describe('rankVideoCandidates', () => {
  it('ordena el resultado oficial por delante del cover', () => {
    const items = [
      item('Creep (cover by someone)', 'Covers Channel', 'bad'),
      item('Radiohead - Creep (Official Audio)', 'Radiohead', 'good')
    ]
    expect(rankVideoCandidates(items, 'Radiohead', 'Creep')).toEqual(['good', 'bad'])
  })

  it('descarta items sin videoId', () => {
    const items: YouTubeSearchItem[] = [
      { snippet: { title: 'Radiohead - Creep' } },
      item('Radiohead - Creep', 'Radiohead', 'ok')
    ]
    expect(rankVideoCandidates(items, 'Radiohead', 'Creep')).toEqual(['ok'])
  })

  it('es estable ante empate (respeta orden de la API)', () => {
    const items = [item('Mismo título', '', 'first'), item('Mismo título', '', 'second')]
    expect(rankVideoCandidates(items, 'x', 'mismo título')).toEqual(['first', 'second'])
  })

  it('devuelve [] con lista vacía', () => {
    expect(rankVideoCandidates([], 'a', 'b')).toEqual([])
  })
})
