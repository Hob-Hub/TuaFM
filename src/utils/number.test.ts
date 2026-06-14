import { describe, it, expect } from 'vitest'
import { toInt } from '@/utils/number'

describe('toInt', () => {
  it('parsea enteros en base 10', () => {
    expect(toInt('42')).toBe(42)
    expect(toInt('0')).toBe(0)
    expect(toInt('1200')).toBe(1200)
  })

  it('tolera texto numérico con sufijo', () => {
    expect(toInt('15abc')).toBe(15)
  })

  it('devuelve undefined ante valores no parseables o nulos', () => {
    expect(toInt('')).toBeUndefined()
    expect(toInt('abc')).toBeUndefined()
    expect(toInt(null)).toBeUndefined()
    expect(toInt(undefined)).toBeUndefined()
  })
})
