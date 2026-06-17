import { describe, expect, it } from 'vitest'
import { isTrustedArtworkUrl } from './lastfm.mjs'

describe('isTrustedArtworkUrl', () => {
  it('accepts trusted chart artwork hosts with image paths', () => {
    expect(isTrustedArtworkUrl('https://media.fimi.it/folder_18/example.jpg')).toBe(true)
    expect(isTrustedArtworkUrl('https://recursosweb.prisaradio.com/fotos/dest/010006466119.jpg')).toBe(true)
    expect(isTrustedArtworkUrl('https://snepmusique.com/wp-content/uploads/cover_ms/youssou-n-dour-the-guide-wommat.jpg')).toBe(true)
    expect(isTrustedArtworkUrl('https://images.music-story.com/img/cover_art/curation/400/f/5/1/3/ab3d.jpeg')).toBe(true)
  })

  it('rejects non-image Music Story placeholders', () => {
    expect(isTrustedArtworkUrl('https://images.music-story.com')).toBe(false)
  })
})
