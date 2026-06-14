import { createRouter, createWebHistory, type RouteLocationNormalized } from 'vue-router'
import { i18n } from '@/i18n'
import { usePlayerStore } from '@/stores/player.store'

const router = createRouter({
  history: createWebHistory(),
  // Volver arriba al navegar; respeta el botón atrás/adelante.
  scrollBehavior: (_to, _from, saved) => saved ?? { top: 0 },
  routes: [
    // meta.titleKey → clave i18n que se traduce en afterEach.
    { path: '/',                 name: 'home',     component: () => import('@/views/HomeView.vue'),            meta: { titleKey: 'nav.home' } },
    { path: '/search',           name: 'search',   component: () => import('@/views/SearchView.vue'),          meta: { titleKey: 'nav.search' } },
    { path: '/playlist/:id',     name: 'playlist', component: () => import('@/views/PlaylistView.vue'),        meta: { titleKey: 'playlist.label' } },
    { path: '/radio',            name: 'radio',    component: () => import('@/views/RadioView.vue'),           meta: { titleKey: 'nav.radio' } },
    { path: '/chart/:chartId/:year', name: 'chart', component: () => import('@/views/ChartView.vue') },
    { path: '/recommendations',  name: 'recs',     component: () => import('@/views/RecommendationsView.vue'), meta: { titleKey: 'nav.recs' } },
    { path: '/favorites',        name: 'favorites', component: () => import('@/views/FavoritesView.vue'),       meta: { titleKey: 'nav.favorites' } },
    { path: '/history',          name: 'history',  component: () => import('@/views/HistoryView.vue'),         meta: { titleKey: 'nav.history' } },
    { path: '/settings',         name: 'settings', component: () => import('@/views/SettingsView.vue'),        meta: { titleKey: 'nav.settings' } },
    { path: '/artist/:name',     name: 'artist',   component: () => import('@/views/ArtistView.vue') }
  ]
})

// Título de la pestaña por ruta. Las vistas con datos asíncronos (artista,
// chart, playlist) pueden refinarlo en su onMounted; este hook fija un valor
// sensato de inmediato a partir de la URL.
export const BASE_TITLE = 'TuaFM'

/** Título de pestaña derivado de la ruta (sin tener en cuenta la reproducción). */
export function routeTitle(to: RouteLocationNormalized): string {
  const key = to.meta.titleKey as string | undefined
  let title = key ? i18n.global.t(key) : undefined
  if (to.name === 'artist') title = decodeURIComponent(String(to.params.name))
  else if (to.name === 'chart') title = i18n.global.t('chart.top', { year: to.params.year })
  return title ? `${title} · ${BASE_TITLE}` : BASE_TITLE
}

router.afterEach((to) => {
  // Si hay una pista cargada, el título de "ahora sonando" lo gobierna App.vue;
  // no lo pisamos al navegar.
  if (usePlayerStore().currentTrackId) return
  document.title = routeTitle(to)
})

export default router
