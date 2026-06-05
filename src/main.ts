import { createApp }   from 'vue'
import { createPinia } from 'pinia'
import piniaPersistedstate from 'pinia-plugin-persistedstate'
import router from '@/router/index'
import { ensureAnonymousAuth, isFirebaseConfigured } from '@/firebase/index'
import App    from './App.vue'
import './style.css'

const pinia = createPinia()
pinia.use(piniaPersistedstate)

createApp(App).use(pinia).use(router).mount('#app')

// Auth anónima en background — necesaria para escribir en track_cache. Solo si
// Firebase está configurado; en modo local no se intenta (evita ruido en consola).
// No bloquea el render.
if (isFirebaseConfigured) {
  ensureAnonymousAuth().catch(err => console.warn('[auth] anónima no disponible:', err))
}
