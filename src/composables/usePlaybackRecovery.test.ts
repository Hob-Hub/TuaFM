import { describe, it, expect } from 'vitest'
import { buildCandidates } from '@/composables/usePlaybackRecovery'
import type { Track } from '@/types/track.types'

function track(data: Partial<Track>): Track {
  return { id: 'x', artist: 'a', title: 't', enriched: false, ...data }
}

describe('buildCandidates', () => {
  it('pone el mejor vídeo primero y luego los alternativos', () => {
    const t = track({ youtubeVideoId: 'best', youtubeCandidates: ['alt1', 'alt2'] })
    expect(buildCandidates(t)).toEqual(['best', 'alt1', 'alt2'])
  })

  it('no duplica el mejor vídeo si también está entre los candidatos', () => {
    const t = track({ youtubeVideoId: 'best', youtubeCandidates: ['best', 'alt1'] })
    expect(buildCandidates(t)).toEqual(['best', 'alt1'])
  })

  it('funciona solo con candidatos alternativos', () => {
    const t = track({ youtubeCandidates: ['alt1', 'alt2'] })
    expect(buildCandidates(t)).toEqual(['alt1', 'alt2'])
  })

  it('devuelve lista vacía si no hay ningún vídeo', () => {
    expect(buildCandidates(track({}))).toEqual([])
  })
})
