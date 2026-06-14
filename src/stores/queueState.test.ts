import { describe, it, expect } from 'vitest'
import { createQueueState } from '@/stores/queueState'
import type { Track } from '@/types/track.types'

function track(id: string): Track {
  return { id, artist: 'a', title: id, enriched: false }
}

describe('createQueueState', () => {
  it('arranca vacío e inactivo', () => {
    const q = createQueueState()
    expect(q.isActive.value).toBe(false)
    expect(q.currentTrack.value).toBeNull()
    expect(q.hasNext.value).toBe(false)
    expect(q.hasPrev.value).toBe(false)
  })

  it('expone la pista actual y los flags de navegación', () => {
    const q = createQueueState()
    q.queue.value = [track('a'), track('b'), track('c')]
    expect(q.isActive.value).toBe(true)
    expect(q.currentTrack.value?.id).toBe('a')
    expect(q.hasPrev.value).toBe(false)
    expect(q.hasNext.value).toBe(true)
  })

  it('avanza y retrocede sin salirse de los límites', () => {
    const q = createQueueState()
    q.queue.value = [track('a'), track('b')]
    q.prev()                       // ya en la primera: no baja de 0
    expect(q.currentIndex.value).toBe(0)
    q.next()
    expect(q.currentIndex.value).toBe(1)
    q.next()                       // ya en la última: no pasa del final
    expect(q.currentIndex.value).toBe(1)
  })

  it('skipTo recorta el índice al rango válido', () => {
    const q = createQueueState()
    q.queue.value = [track('a'), track('b'), track('c')]
    q.skipTo(99)
    expect(q.currentIndex.value).toBe(2)
    q.skipTo(-5)
    expect(q.currentIndex.value).toBe(0)
  })

  it('updateTrack fusiona datos sobre la pista por id', () => {
    const q = createQueueState()
    q.queue.value = [track('a'), track('b')]
    q.updateTrack('b', { coverUrl: 'cover-b', enriched: true })
    expect(q.queue.value[1].coverUrl).toBe('cover-b')
    expect(q.queue.value[1].enriched).toBe(true)
    expect(q.queue.value[0].coverUrl).toBeUndefined()
  })

  it('updateTrack ignora ids inexistentes', () => {
    const q = createQueueState()
    q.queue.value = [track('a')]
    q.updateTrack('zzz', { coverUrl: 'x' })
    expect(q.queue.value[0].coverUrl).toBeUndefined()
  })
})
