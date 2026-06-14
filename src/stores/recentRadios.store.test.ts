import { describe, it, expect, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useRecentRadiosStore, type RecentRadio } from '@/stores/recentRadios.store'

type RadioInput = Omit<RecentRadio, 'at'>

function radio(partial: Partial<RadioInput> = {}): RadioInput {
  return {
    chartId: 'es-40',
    year: 2012,
    lambda: 0.35,
    country: 'ES',
    name: 'Los 40',
    flag: '🇪🇸',
    ...partial,
  }
}

describe('recentRadios.store', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('registra una radio y la marca con timestamp', () => {
    const store = useRecentRadiosStore()
    store.record(radio())
    expect(store.items).toHaveLength(1)
    expect(store.items[0]).toMatchObject({ chartId: 'es-40', year: 2012 })
    expect(typeof store.items[0].at).toBe('number')
  })

  it('coloca la más reciente al principio', () => {
    const store = useRecentRadiosStore()
    store.record(radio({ year: 2010 }))
    store.record(radio({ year: 2011 }))
    expect(store.items.map(r => r.year)).toEqual([2011, 2010])
  })

  it('deduplica por lista+año, conservando la entrada nueva al frente', () => {
    const store = useRecentRadiosStore()
    store.record(radio({ year: 2012, lambda: 0.2 }))
    store.record(radio({ year: 2013 }))
    store.record(radio({ year: 2012, lambda: 0.8 })) // misma lista+año, λ distinto
    expect(store.items).toHaveLength(2)
    expect(store.items[0]).toMatchObject({ year: 2012, lambda: 0.8 })
    expect(store.items[1].year).toBe(2013)
  })

  it('no deduplica el mismo año en listas distintas', () => {
    const store = useRecentRadiosStore()
    store.record(radio({ chartId: 'es-40', year: 2012 }))
    store.record(radio({ chartId: 'it-fimi', year: 2012 }))
    expect(store.items).toHaveLength(2)
  })

  it('mantiene como mucho 8 entradas (descarta la más antigua)', () => {
    const store = useRecentRadiosStore()
    for (let y = 2000; y <= 2010; y++) store.record(radio({ year: y }))
    expect(store.items).toHaveLength(8)
    expect(store.items.map(r => r.year)).toEqual([2010, 2009, 2008, 2007, 2006, 2005, 2004, 2003])
  })

  it('clear vacía el historial', () => {
    const store = useRecentRadiosStore()
    store.record(radio())
    store.clear()
    expect(store.items).toHaveLength(0)
  })
})
