import { createRouter, createWebHistory } from 'vue-router'

export default createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/',                 name: 'home',     component: () => import('@/views/HomeView.vue') },
    { path: '/search',           name: 'search',   component: () => import('@/views/SearchView.vue') },
    { path: '/playlist/:id',     name: 'playlist', component: () => import('@/views/PlaylistView.vue') },
    { path: '/radio',            name: 'radio',    component: () => import('@/views/RadioView.vue') },
    { path: '/recommendations',  name: 'recs',     component: () => import('@/views/RecommendationsView.vue') },
    { path: '/history',          name: 'history',  component: () => import('@/views/HistoryView.vue') },
    { path: '/artist/:name',     name: 'artist',   component: () => import('@/views/ArtistView.vue') }
  ]
})
