import { describe, expect, it } from 'vitest'
import { inferTrackLanguage } from './language.mjs'

describe('inferTrackLanguage', () => {
  it('prefiere un titulo ingles claro frente a artista/chart latinos', () => {
    const artists = [{ tags: ['spanish', 'latin'] }]
    const result = inferTrackLanguage(
      { title: 'Back in the City', artistId: 0, artistIds: [0], tags: ['latin'] },
      artists,
      { es: 10 },
    )

    expect(result.language).toBe('en')
    expect(result.languageConfidence).toBeGreaterThanOrEqual(0.65)
  })

  it('reconoce un titulo italiano aunque aparezca en un chart espanol', () => {
    const result = inferTrackLanguage({ title: 'Soldi' }, [], { es: 10 })

    expect(result.language).toBe('it')
  })

  it('no convierte tags de genero en codigos de idioma', () => {
    const result = inferTrackLanguage({ title: 'No Lie', tags: ['Hip-Hop'] }, [], { en: 1 })

    expect(result.language).not.toBe('hi')
    expect(result.language).toBe('en')
  })

  it('no deja que tags k-pop repetidos ganen a un titulo ingles claro', () => {
    const result = inferTrackLanguage({ title: 'Butter', tags: ['k-pop', 'Kpop'] }, [], { en: 1 })

    expect(result.language).toBe('en')
  })

  it('normaliza overrides manuales escritos como nombres de idioma', () => {
    const result = inferTrackLanguage({ title: 'Anything', language: 'spanish' })

    expect(result.language).toBe('es')
    expect(result.languageSource).toBe('override')
  })
})
