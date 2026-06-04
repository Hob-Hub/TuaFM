import { describe, it, expect } from 'vitest'
import { normalizeStr, makeCacheKey } from '@/utils/normalize'

describe('normalizeStr', () => {
  it('pasa a minúsculas y recorta', () => {
    expect(normalizeStr('  Radiohead ')).toBe('radiohead')
  })

  it('elimina diacríticos (NFD)', () => {
    expect(normalizeStr('Beyoncé')).toBe('beyonce')
    expect(normalizeStr('Café Quijano')).toBe('cafe quijano')
    expect(normalizeStr('Björk')).toBe('bjork')
    expect(normalizeStr('Mägo de Oz')).toBe('mago de oz')
  })

  it('colapsa espacios múltiples', () => {
    expect(normalizeStr('David   Bisbal')).toBe('david bisbal')
  })

  it('es idempotente', () => {
    const once = normalizeStr('Café Quijano')
    expect(normalizeStr(once)).toBe(once)
  })
})

describe('makeCacheKey', () => {
  it('combina artista y título normalizados con ::', () => {
    expect(makeCacheKey('Radiohead', 'Creep')).toBe('radiohead::creep')
  })

  it('produce la misma clave para variantes con/sin acentos', () => {
    expect(makeCacheKey('Café Quijano', 'La Lola'))
      .toBe(makeCacheKey('cafe quijano', 'la lola'))
  })
})
