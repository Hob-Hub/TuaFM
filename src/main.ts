import { createApp }   from 'vue'
import { createPinia } from 'pinia'
import piniaPersistedstate from 'pinia-plugin-persistedstate'
import router from '@/router/index'
import App    from './App.vue'
import { pruneExpiredCaches } from '@/db/cache.maintenance'
import './style.css'

const pinia = createPinia()
pinia.use(piniaPersistedstate)

createApp(App).use(pinia).use(router).mount('#app')

// Acota IndexedDB: borra entradas de caché caducadas. En segundo plano, sin
// bloquear el arranque, y silencioso (si IndexedDB falla, la app sigue).
void pruneExpiredCaches().catch(() => {})
