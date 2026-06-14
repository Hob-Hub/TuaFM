import { describe, it, expect } from 'vitest'
import { makeTrack } from '@/utils/track'

describe('makeTrack', () => {
  it('aplica los valores por defecto (id propio y enriched: false)', () => {
    const t = makeTrack({ artist: 'Radiohead', title: 'Creep' })
    expect(t.artist).toBe('Radiohead')
    expect(t.title).toBe('Creep')
    expect(t.enriched).toBe(false)
    expect(t.id).toBeTruthy()
  })

  it('genera ids distintos en cada llamada', () => {
    const a = makeTrack({ artist: 'a', title: 'x' })
    const b = makeTrack({ artist: 'a', title: 'x' })
    expect(a.id).not.toBe(b.id)
  })

  it('permite sobrescribir los valores por defecto', () => {
    const t = makeTrack({ id: 'fixed', artist: 'a', title: 'x', enriched: true })
    expect(t.id).toBe('fixed')
    expect(t.enriched).toBe(true)
  })

  it('conserva los campos opcionales pasados', () => {
    const t = makeTrack({ artist: 'a', title: 'x', coverUrl: 'u', youtubeVideoId: 'vid' })
    expect(t.coverUrl).toBe('u')
    expect(t.youtubeVideoId).toBe('vid')
  })
})
