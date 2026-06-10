import { createApp }   from 'vue'
import { createPinia } from 'pinia'
import piniaPersistedstate from 'pinia-plugin-persistedstate'
import router from '@/router/index'
import App    from './App.vue'
import './style.css'

const pinia = createPinia()
pinia.use(piniaPersistedstate)

createApp(App).use(pinia).use(router).mount('#app')
