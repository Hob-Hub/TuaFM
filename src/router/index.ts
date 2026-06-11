import { createRouter, createWebHistory } from 'vue-router'

const router = createRouter({
  history: createWebHistory(),
  // Volver arriba al navegar; respeta el botón atrás/adelante.
  scrollBehavior: (_to, _from, saved) => saved ?? { top: 0 },
  routes: [
    { path: '/',                 name: 'home',     component: () => import('@/views/HomeView.vue'),            meta: { title: 'Inicio' } },
    { path: '/search',           name: 'search',   component: () => import('@/views/SearchView.vue'),          meta: { title: 'Buscar' } },
    { path: '/playlist/:id',     name: 'playlist', component: () => import('@/views/PlaylistView.vue'),        meta: { title: 'Playlist' } },
    { path: '/radio',            name: 'radio',    component: () => import('@/views/RadioView.vue'),           meta: { title: 'Radio' } },
    { path: '/chart/:chartId/:year', name: 'chart', component: () => import('@/views/ChartView.vue') },
    { path: '/recommendations',  name: 'recs',     component: () => import('@/views/RecommendationsView.vue'), meta: { title: 'Recomendaciones' } },
    { path: '/history',          name: 'history',  component: () => import('@/views/HistoryView.vue'),         meta: { title: 'Historial' } },
    { path: '/artist/:name',     name: 'artist',   component: () => import('@/views/ArtistView.vue') }
  ]
})

// Título de la pestaña por ruta. Las vistas con datos asíncronos (artista,
// chart, playlist) pueden refinarlo en su onMounted; este hook fija un valor
// sensato de inmediato a partir de la URL.
const BASE = 'TuaFM'
router.afterEach((to) => {
  let title = to.meta.title as string | undefined
  if (to.name === 'artist') title = decodeURIComponent(String(to.params.name))
  else if (to.name === 'chart') title = `Chart ${to.params.year}`
  document.title = title ? `${title} · ${BASE}` : BASE
})

export default router
