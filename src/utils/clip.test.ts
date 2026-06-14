import { describe, it, expect } from 'vitest'
import { clipCentreStart } from '@/utils/clip'

describe('clipCentreStart', () => {
  it('centra el trozo dentro de la pista', () => {
    // pista de 200s, clip de 40s → arranca en 80 (centro - mitad del clip)
    expect(clipCentreStart(200, 40)).toBe(80)
  })

  it('no devuelve un inicio negativo si el clip dura más que la pista', () => {
    expect(clipCentreStart(30, 90)).toBe(0)
  })

  it('centra el clip cuando casi llena la pista', () => {
    // 40s centrados en 50s → arranca en 5 (suena 5..45), dentro de [0, 10]
    expect(clipCentreStart(50, 40)).toBe(5)
  })

  it('arranca en 0 cuando no se conoce la duración', () => {
    expect(clipCentreStart(0, 40)).toBe(0)
  })
})
