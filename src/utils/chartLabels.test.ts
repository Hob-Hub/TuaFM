import { describe, it, expect, beforeAll } from 'vitest'
import { i18n } from '@/i18n'
import { chartCountryName, radioSourceLabel } from '@/utils/chartLabels'

beforeAll(() => {
  i18n.global.locale.value = 'es'
})

describe('chartCountryName', () => {
  it('localiza un código de país conocido', () => {
    expect(chartCountryName('ES')).toBe('España')
    expect(chartCountryName('IT')).toBe('Italia')
  })

  it('cae al fallback cuando el país no existe en el diccionario', () => {
    expect(chartCountryName('XX', 'Lista Antigua')).toBe('Lista Antigua')
  })

  it('usa el propio código como último recurso si no hay fallback', () => {
    expect(chartCountryName('XX')).toBe('XX')
  })

  it('devuelve el fallback (o cadena vacía) cuando no hay país', () => {
    expect(chartCountryName(undefined, 'Lista Antigua')).toBe('Lista Antigua')
    expect(chartCountryName(undefined)).toBe('')
  })
})

describe('radioSourceLabel', () => {
  it('compone "País · Año"', () => {
    expect(radioSourceLabel('ES', 2012)).toBe('España · 2012')
  })

  it('usa el fallback como nombre cuando no hay traducción', () => {
    expect(radioSourceLabel('XX', 2012, 'Lista Antigua')).toBe('Lista Antigua · 2012')
  })

  it('cae a solo el año cuando no hay país ni fallback', () => {
    expect(radioSourceLabel(undefined, 2012)).toBe('2012')
  })
})
