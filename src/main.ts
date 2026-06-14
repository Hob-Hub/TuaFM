import { createApp, watch } from 'vue'
import { createPinia } from 'pinia'
import piniaPersistedstate from 'pinia-plugin-persistedstate'
import router from '@/router/index'
import App    from './App.vue'
import { i18n, type AppLocale } from '@/i18n'
import { useSettingsStore } from '@/stores/settings.store'
import { pruneExpiredCaches } from '@/db/cache.maintenance'
import './style.css'

const pinia = createPinia()
pinia.use(piniaPersistedstate)

// Aplica el idioma (el del dispositivo por defecto, o la elección persistida del
// usuario) a vue-i18n y al <html lang>, y lo mantiene en sync con la preferencia.
const settings = useSettingsStore(pinia)
function applyLocale(locale: AppLocale): void {
  i18n.global.locale.value = locale
  document.documentElement.lang = locale
}
applyLocale(settings.locale)
watch(() => settings.locale, applyLocale)

createApp(App).use(pinia).use(i18n).use(router).mount('#app')

// Acota IndexedDB: borra entradas de caché caducadas. En segundo plano, sin
// bloquear el arranque, y silencioso (si IndexedDB falla, la app sigue).
void pruneExpiredCaches().catch(() => {})
