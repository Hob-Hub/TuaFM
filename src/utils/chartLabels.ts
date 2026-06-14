import { i18n } from '@/i18n'

/**
 * Nombre localizado de una lista a partir de su código de país ISO (ES/FR/IT/US).
 * Cae al `fallback` (el nombre original del registry) si no hay traducción —p. ej.
 * para una entrada antigua persistida sin país o un código nuevo sin clave.
 *
 * Usa `i18n.global.t`, que lee el locale reactivo: dentro de un `computed` de
 * componente se reevalúa al cambiar de idioma.
 */
export function chartCountryName(country: string | undefined, fallback?: string): string {
  if (!country) return fallback ?? ''
  const key = `country.${country}`
  const translated = i18n.global.t(key)
  return translated === key ? (fallback ?? country) : translated
}

/** Etiqueta de fuente de la radio: "País · Año" (p. ej. "España · 2012"). */
export function radioSourceLabel(country: string | undefined, year: number, fallback?: string): string {
  const name = chartCountryName(country, fallback)
  return name ? `${name} · ${year}` : String(year)
}
