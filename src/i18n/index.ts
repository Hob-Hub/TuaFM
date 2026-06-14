import { createI18n } from 'vue-i18n'
import es from './locales/es'
import en from './locales/en'
import it from './locales/it'
import fr from './locales/fr'

// Idiomas soportados. El primero NO implica preferencia: el idioma por defecto se
// decide en runtime a partir del dispositivo (ver settings.store).
export const SUPPORTED_LOCALES = ['es', 'en', 'it', 'fr'] as const
export type AppLocale = (typeof SUPPORTED_LOCALES)[number]

// Idioma de reserva cuando el del dispositivo no es ninguno de los soportados,
// o para claves sin traducir. Internacional por cubrir charts de varios países.
export const FALLBACK_LOCALE: AppLocale = 'en'

// Etiqueta nativa de cada idioma para el selector (siempre en su propio idioma).
export const LOCALE_LABELS: Record<AppLocale, string> = {
  es: 'Español',
  en: 'English',
  it: 'Italiano',
  fr: 'Français',
}

// Formatos de fecha/hora por idioma. Sustituyen al 'es-ES' hardcodeado previo.
const datetimeFormats = Object.fromEntries(
  SUPPORTED_LOCALES.map((l) => [
    l,
    {
      dayHeading: { weekday: 'long', day: 'numeric', month: 'long' },
      time: { hour: '2-digit', minute: '2-digit' },
    },
  ]),
) as Record<AppLocale, Record<'dayHeading' | 'time', Intl.DateTimeFormatOptions>>

// Formato numérico con separador de millares según el idioma activo.
const numberFormats = Object.fromEntries(
  SUPPORTED_LOCALES.map((l) => [l, { decimal: { style: 'decimal' } }]),
) as Record<AppLocale, Record<'decimal', Intl.NumberFormatOptions>>

export const i18n = createI18n({
  legacy: false,
  globalInjection: true, // expone $t/$d/$n en las plantillas
  locale: FALLBACK_LOCALE,
  fallbackLocale: FALLBACK_LOCALE,
  messages: { es, en, it, fr },
  datetimeFormats,
  numberFormats,
})

/** ¿Es `value` uno de los idiomas soportados? */
export function isSupportedLocale(value: string): value is AppLocale {
  return (SUPPORTED_LOCALES as readonly string[]).includes(value)
}
