import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useSettingsStore } from '@/stores/settings.store'

/** Simula navigator.languages para probar la detección de idioma del dispositivo. */
function stubLanguages(languages: string[]): void {
  vi.stubGlobal('navigator', { languages, language: languages[0] })
}

describe('settings.store · detección de idioma', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('arranca en el primer idioma soportado del dispositivo', () => {
    stubLanguages(['it-IT', 'en-US'])
    expect(useSettingsStore().locale).toBe('it')
  })

  it('ignora la región del código de idioma (it-IT → it)', () => {
    stubLanguages(['fr-CA'])
    expect(useSettingsStore().locale).toBe('fr')
  })

  it('salta idiomas no soportados hasta encontrar uno válido', () => {
    stubLanguages(['de-DE', 'pt-PT', 'es-ES'])
    expect(useSettingsStore().locale).toBe('es')
  })

  it('cae al idioma de reserva (en) si ninguno está soportado', () => {
    stubLanguages(['de-DE', 'ja-JP'])
    expect(useSettingsStore().locale).toBe('en')
  })

  it('usa navigator.language cuando languages está vacío', () => {
    vi.stubGlobal('navigator', { languages: [], language: 'es-ES' })
    expect(useSettingsStore().locale).toBe('es')
  })

  it('setLocale sobrescribe la detección automática', () => {
    stubLanguages(['en-US'])
    const store = useSettingsStore()
    store.setLocale('fr')
    expect(store.locale).toBe('fr')
  })
})
