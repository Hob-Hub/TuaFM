import { describe, it, expect } from 'vitest'
import {
  isExpired, makeLastfmCacheKey,
  TTL_ARTIST_DAYS, TTL_COVER_DAYS, TTL_SIMILARITY_DAYS
} from './cache.helpers'

const DAY = 86_400_000

describe('isExpired', () => {
  const now = 1_000 * DAY

  it('no expira dentro del TTL', () => {
    expect(isExpired(now - 5 * DAY, 30, now)).toBe(false)
  })

  it('expira pasado el TTL', () => {
    expect(isExpired(now - 31 * DAY, 30, now)).toBe(true)
  })

  it('justo en el límite (== TTL) aún es válido', () => {
    expect(isExpired(now - 30 * DAY, 30, now)).toBe(false)
  })

  it('un instante después del límite expira', () => {
    expect(isExpired(now - 30 * DAY - 1, 30, now)).toBe(true)
  })

  it('TTLs definidos son coherentes (covers > artista = similitud)', () => {
    expect(TTL_COVER_DAYS).toBeGreaterThan(TTL_ARTIST_DAYS)
    expect(TTL_ARTIST_DAYS).toBe(TTL_SIMILARITY_DAYS)
  })
})

describe('makeLastfmCacheKey', () => {
  it('misma combinación → misma clave', () => {
    const a = makeLastfmCacheKey('artist.getTopTracks', { artist: 'Daft Punk', limit: 50 })
    const b = makeLastfmCacheKey('artist.getTopTracks', { artist: 'Daft Punk', limit: 50 })
    expect(a).toBe(b)
  })

  it('es independiente del orden de los argumentos', () => {
    const a = makeLastfmCacheKey('track.getSimilar', { artist: 'Air', track: 'Playground Love', limit: 15 })
    const b = makeLastfmCacheKey('track.getSimilar', { limit: 15, track: 'Playground Love', artist: 'Air' })
    expect(a).toBe(b)
  })

  it('normaliza mayúsculas/espacios para no duplicar entradas', () => {
    const a = makeLastfmCacheKey('artist.getSimilar', { artist: 'Daft Punk' })
    const b = makeLastfmCacheKey('artist.getSimilar', { artist: '  daft punk  ' })
    expect(a).toBe(b)
  })

  it('distingue por método', () => {
    const a = makeLastfmCacheKey('artist.getTopTracks', { artist: 'X' })
    const b = makeLastfmCacheKey('artist.getSimilar', { artist: 'X' })
    expect(a).not.toBe(b)
  })

  it('distingue por valor de argumento', () => {
    const a = makeLastfmCacheKey('artist.getTopTracks', { artist: 'X', limit: 15 })
    const b = makeLastfmCacheKey('artist.getTopTracks', { artist: 'X', limit: 50 })
    expect(a).not.toBe(b)
  })
})
