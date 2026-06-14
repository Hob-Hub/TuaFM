import { describe, it, expect } from 'vitest'
import { splitArtists } from '@/utils/artists'

describe('splitArtists', () => {
  it('un solo artista queda intacto', () => {
    expect(splitArtists('Radiohead')).toEqual(['Radiohead'])
  })

  it('separa por coma', () => {
    expect(splitArtists('David Guetta, Akon')).toEqual(['David Guetta', 'Akon'])
  })

  it('separa por &', () => {
    expect(splitArtists('Tiësto & Dyro')).toEqual(['Tiësto', 'Dyro'])
  })

  it('separa por feat./ft.', () => {
    expect(splitArtists('Jay-Z feat. Alicia Keys')).toEqual(['Jay-Z', 'Alicia Keys'])
    expect(splitArtists('Eminem ft. Rihanna')).toEqual(['Eminem', 'Rihanna'])
  })

  it('separa colaboraciones con " x "', () => {
    expect(splitArtists('Martin Garrix x Bebe Rexha')).toEqual(['Martin Garrix', 'Bebe Rexha'])
  })

  it('deduplica sin distinguir mayúsculas', () => {
    expect(splitArtists('ABBA & abba')).toEqual(['ABBA'])
  })

  it('no parte nombres que contienen las letras separadoras', () => {
    expect(splitArtists('Maxwell')).toEqual(['Maxwell'])
    expect(splitArtists('Foxes')).toEqual(['Foxes'])
  })
})
