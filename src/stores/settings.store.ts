import { defineStore } from 'pinia'
import { ref } from 'vue'
import { FALLBACK_LOCALE, isSupportedLocale, type AppLocale } from '@/i18n'

/** Idioma del dispositivo si está entre los soportados; si no, el de reserva. */
function detectDeviceLocale(): AppLocale {
  const candidates = navigator.languages?.length ? navigator.languages : [navigator.language]
  for (const lang of candidates) {
    const base = lang.toLowerCase().split('-')[0]
    if (isSupportedLocale(base)) return base
  }
  return FALLBACK_LOCALE
}

/**
 * Preferencias de la app. El idioma arranca en el del dispositivo; si el usuario
 * lo cambia, el plugin de persistencia restaura esa elección en próximas visitas
 * (sobrescribe la detección automática).
 */
export const useSettingsStore = defineStore(
  'settings',
  () => {
    const locale = ref<AppLocale>(detectDeviceLocale())

    function setLocale(value: AppLocale): void {
      locale.value = value
    }

    return { locale, setLocale }
  },
  { persist: true },
)
