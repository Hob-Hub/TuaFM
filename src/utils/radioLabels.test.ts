import { describe, it, expect, beforeAll } from 'vitest'
import { i18n } from '@/i18n'
import { nostalgiaLabel } from '@/utils/radioLabels'

beforeAll(() => {
  i18n.global.locale.value = 'es'
})

describe('nostalgiaLabel', () => {
  it('mapea cada tramo de λ a su etiqueta', () => {
    expect(nostalgiaLabel(1.0)).toBe('Solo ese año')
    expect(nostalgiaLabel(0.7)).toBe('Sobre todo ese año')
    expect(nostalgiaLabel(0.4)).toBe('Mezcla cercana')
    expect(nostalgiaLabel(0.25)).toBe('Mezcla amplia')
    expect(nostalgiaLabel(0.1)).toBe('Mezcla de épocas')
  })

  it('respeta los límites inferiores de cada tramo (inclusivos)', () => {
    expect(nostalgiaLabel(0.8)).toBe('Solo ese año')
    expect(nostalgiaLabel(0.55)).toBe('Sobre todo ese año')
    expect(nostalgiaLabel(0.35)).toBe('Mezcla cercana')
    expect(nostalgiaLabel(0.2)).toBe('Mezcla amplia')
  })

  it('justo por debajo de un límite cae al tramo siguiente', () => {
    expect(nostalgiaLabel(0.79)).toBe('Sobre todo ese año')
    expect(nostalgiaLabel(0.54)).toBe('Mezcla cercana')
    expect(nostalgiaLabel(0.34)).toBe('Mezcla amplia')
    expect(nostalgiaLabel(0.19)).toBe('Mezcla de épocas')
  })

  it('es monótono: más λ nunca produce una mezcla más amplia', () => {
    const labels = [0.1, 0.2, 0.35, 0.55, 0.8].map(nostalgiaLabel)
    expect(new Set(labels).size).toBe(5) // los cinco tramos son distintos
  })

  it('se reevalúa al cambiar de idioma', () => {
    i18n.global.locale.value = 'en'
    expect(nostalgiaLabel(1.0)).not.toBe('Solo ese año')
    i18n.global.locale.value = 'es'
  })
})
