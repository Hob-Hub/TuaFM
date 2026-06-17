import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Track } from '@/types/track.types'

const mockDb = vi.hoisted(() => {
  const rows = new Map<string, unknown>()
  const failedTracks = {
    get: vi.fn((key: string) => Promise.resolve(rows.get(key))),
    put: vi.fn((row: { cacheKey: string }) => {
      rows.set(row.cacheKey, row)
      return Promise.resolve(row.cacheKey)
    }),
    delete: vi.fn((key: string) => {
      rows.delete(key)
      return Promise.resolve()
    }),
    clear: vi.fn(() => {
      rows.clear()
      return Promise.resolve()
    }),
    orderBy: vi.fn(() => ({
      reverse: () => ({
        toArray: () => Promise.resolve([...rows.values()].reverse())
      })
    }))
  }
  return { rows, failedTracks }
})

vi.mock('@/db/local.db', () => {
  const normalize = (value: string): string => value
    .toLowerCase()
    .trim()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')

  return {
    db: { failedTracks: mockDb.failedTracks },
    makeCacheKey: (artist: string, title: string) => `${normalize(artist)}::${normalize(title)}`
  }
})

import { clearFailure, clearFailures, recordFailure } from '@/composables/useFailedTracks'

function track(artist: string, title: string): Track {
  return { id: `${artist}-${title}`, artist, title, enriched: false }
}

describe('failed track registry', () => {
  beforeEach(() => {
    mockDb.rows.clear()
    vi.clearAllMocks()
  })

  it('borra del listado una pista que ya vuelve a reproducirse', async () => {
    await recordFailure(track('COEZ', "La Musica Non C'e"), 'playback-error', ['old-id'], 'radio')
    await recordFailure(track('RHOVE', 'Shakerando'), 'playback-error', ['other-id'], 'radio')

    await clearFailure(track('coez', "La Musica Non C'e"))

    expect(mockDb.failedTracks.delete).toHaveBeenCalledWith("coez::la musica non c'e")
    expect(mockDb.rows.has("coez::la musica non c'e")).toBe(false)
    expect(mockDb.rows.has('rhove::shakerando')).toBe(true)
  })

  it('vacía el listado completo cuando el usuario lo pide', async () => {
    await recordFailure(track('Harry Styles', 'As It Was'), 'playback-error', ['old-id'], 'playlist')

    await clearFailures()

    expect(mockDb.failedTracks.clear).toHaveBeenCalled()
    expect(mockDb.rows.size).toBe(0)
  })
})
