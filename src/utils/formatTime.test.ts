import { describe, it, expect } from 'vitest'
import { formatSeconds, formatDurationMs } from '@/utils/formatTime'

describe('formatSeconds', () => {
  it('formatea como m:ss con segundos a dos cifras', () => {
    expect(formatSeconds(0)).toBe('0:00')
    expect(formatSeconds(5)).toBe('0:05')
    expect(formatSeconds(65)).toBe('1:05')
    expect(formatSeconds(600)).toBe('10:00')
  })

  it('trunca fracciones de segundo', () => {
    expect(formatSeconds(65.9)).toBe('1:05')
  })

  it('protege ante valores inválidos o negativos', () => {
    expect(formatSeconds(-3)).toBe('0:00')
    expect(formatSeconds(NaN)).toBe('0:00')
    expect(formatSeconds(Infinity)).toBe('0:00')
  })
})

describe('formatDurationMs', () => {
  it('convierte milisegundos a m:ss', () => {
    expect(formatDurationMs(65000)).toBe('1:05')
    expect(formatDurationMs(200000)).toBe('3:20')
  })

  it('redondea al segundo más cercano', () => {
    expect(formatDurationMs(64600)).toBe('1:05')
  })

  it('devuelve cadena vacía si no hay duración', () => {
    expect(formatDurationMs(undefined)).toBe('')
    expect(formatDurationMs(0)).toBe('')
  })
})
