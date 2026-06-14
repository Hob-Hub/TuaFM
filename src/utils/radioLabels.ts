import { i18n } from '@/i18n'

/**
 * Etiqueta humana para el nivel de "nostalgia" (el λ interno): cuánto se ciñe la
 * radio al año de referencia frente a mezclar épocas cercanas. Evita exponer el
 * lambda crudo en la UI. λ alto → solo ese año; λ bajo → mezcla amplia.
 *
 * Usa `i18n.global.t` (locale reactivo): dentro de un `computed` de componente se
 * reevalúa al cambiar de idioma.
 */
export function nostalgiaLabel(lambda: number): string {
  const t = i18n.global.t
  if (lambda >= 0.8)  return t('nostalgia.onlyYear')
  if (lambda >= 0.55) return t('nostalgia.mostlyYear')
  if (lambda >= 0.35) return t('nostalgia.nearMix')
  if (lambda >= 0.2)  return t('nostalgia.wideMix')
  return t('nostalgia.erasMix')
}
