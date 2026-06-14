<script setup lang="ts">
import { onMounted, onBeforeUnmount, ref, watch } from 'vue'
import { RouterView, RouterLink, useRoute } from 'vue-router'
import { routeTitle } from '@/router/index'
import { useOnline, useMediaQuery } from '@vueuse/core'
import { useUiStore } from '@/stores/ui.store'
import { usePlayerStore } from '@/stores/player.store'
import { useYouTubePlayer } from '@/composables/useYouTubePlayer'
import { useFavorites } from '@/composables/useFavorites'
import ShortcutsHelp from '@/components/ui/ShortcutsHelp.vue'
import { useRadioStore } from '@/stores/radio.store'
import { useRecommendationsStore } from '@/stores/recommendations.store'
import { usePlaylistQueueStore } from '@/stores/playlistQueue.store'
import { usePlayback } from '@/composables/usePlayback'
import AppSidebar from '@/components/layout/AppSidebar.vue'
import PlayerBar from '@/components/layout/PlayerBar.vue'
import YouTubeFrame from '@/components/player/YouTubeFrame.vue'
import NowPlayingScreen from '@/components/player/NowPlayingScreen.vue'
import QueuePanel from '@/components/player/QueuePanel.vue'
import CreatePlaylistModal from '@/components/playlist/CreatePlaylistModal.vue'
import AddTrackModal from '@/components/playlist/AddTrackModal.vue'
import CsvImportModal from '@/components/playlist/CsvImportModal.vue'
import SaveToPlaylistModal from '@/components/playlist/SaveToPlaylistModal.vue'
import PwaUpdatePrompt from '@/components/ui/PwaUpdatePrompt.vue'

const ui = useUiStore()
const online = useOnline()
const player = usePlayerStore()
const radio = useRadioStore()
const rec = useRecommendationsStore()
const pq = usePlaylistQueueStore()
const playback = usePlayback()

const yt = useYouTubePlayer()
const { toggleFavorite } = useFavorites()
const showShortcuts = ref(false)

// Atajos de teclado globales. Espacio = play/pausa; ←/→ = seek ±5s; Shift+←/→ =
// pista anterior/siguiente; M = silenciar; F = favorito; ? = esta ayuda.
function onKey(e: KeyboardEvent): void {
  const tag = (e.target as HTMLElement)?.tagName
  if (tag === 'INPUT' || tag === 'TEXTAREA') return
  // Con la ayuda abierta, solo permitimos cerrarla (Escape lo gestiona el modal).
  if (showShortcuts.value && e.key !== '?') return
  if (e.key === '?') { e.preventDefault(); showShortcuts.value = !showShortcuts.value; return }
  switch (e.code) {
    case 'Space':      e.preventDefault(); playback.togglePlay(); break
    case 'ArrowRight': e.preventDefault(); if (e.shiftKey) playback.next(); else yt.seekTo(player.currentTime + 5); break
    case 'ArrowLeft':  e.preventDefault(); if (e.shiftKey) playback.prev(); else yt.seekTo(Math.max(0, player.currentTime - 5)); break
    case 'KeyM':       yt.toggleMute(); break
    case 'KeyF':       { const t = playback.currentTrack.value; if (t) void toggleFavorite(t); break }
  }
}
onMounted(() => {
  document.addEventListener('keydown', onKey)
  // Reanuda la cola persistida según el modo que quedó activo (radio,
  // recomendaciones o playlist): el reproductor muestra la pista lista para play,
  // sin auto-reproducir (los navegadores bloquean el autoplay al cargar).
  const resumeTrack =
    player.queueMode === 'radio'           && radio.isActive ? radio.currentTrack
  : player.queueMode === 'recommendations' && rec.isActive   ? rec.currentTrack
  : player.queueMode === 'playlist'        && pq.isActive     ? pq.currentTrack
  : null
  if (resumeTrack) player.currentTrackId = resumeTrack.id
  else player.queueMode = 'idle'   // nada persistido que reanudar
})
onBeforeUnmount(() => document.removeEventListener('keydown', onKey))

// Título de pestaña "ahora sonando": mientras hay una pista cargada gana
// "Título — Artista · TuaFM"; al vaciarse, vuelve el título de la ruta.
const route = useRoute()
watch(
  () => {
    const t = playback.currentTrack.value
    return t ? `${t.titleDisplay ?? t.title} — ${t.artistDisplay ?? t.artist} · TuaFM` : null
  },
  (nowPlaying) => { document.title = nowPlaying ?? routeTitle(route) },
  { immediate: true },
)

// La vista a pantalla completa es solo móvil: si se ensancha a escritorio, ciérrala.
const desktop = useMediaQuery('(min-width: 768px)')
watch(desktop, (isDesktop) => { if (isDesktop) ui.closeNowPlaying() })
</script>

<template>
  <div class="h-full grid grid-rows-[1fr_auto] bg-surface">
    <!-- Fila superior: sidebar + contenido -->
    <div class="grid md:grid-cols-[220px_1fr] min-h-0">
      <!-- Sidebar desktop -->
      <div class="hidden md:block border-r border-line min-h-0">
        <AppSidebar />
      </div>

      <!-- Sidebar móvil (drawer) -->
      <Transition name="drawer">
        <div v-if="ui.sidebarOpen" class="md:hidden fixed inset-0 z-40">
          <div class="absolute inset-0 bg-black/60" @click="ui.closeSidebar()" />
          <div class="absolute left-0 top-0 bottom-0 w-64 bg-surface border-r border-line shadow-2xl">
            <AppSidebar />
          </div>
        </div>
      </Transition>

      <!-- Contenido -->
      <main class="min-w-0 min-h-0 overflow-y-auto">
        <!-- Topbar móvil -->
        <div class="md:hidden sticky top-0 z-10 h-14 flex items-center gap-3 px-4 bg-surface/90 backdrop-blur border-b border-line">
          <button class="p-2 -ml-2 rounded-lg text-white" :aria-label="$t('app.openMenu')" @click="ui.toggleSidebar()">
            <svg viewBox="0 0 24 24" class="w-6 h-6" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 6h16M4 12h16M4 18h16"/></svg>
          </button>
          <span class="font-display font-extrabold">Tua<span class="text-brand">FM</span></span>
          <RouterLink :to="{ name: 'search' }" class="ml-auto p-2 -mr-2 rounded-lg text-white" :aria-label="$t('nav.search')">
            <svg viewBox="0 0 24 24" class="w-6 h-6" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></svg>
          </RouterLink>
        </div>

        <!-- Banner offline -->
        <div v-if="!online" class="bg-amber-500/15 text-amber-300 text-sm px-4 py-2 text-center border-b border-amber-500/20">
          {{ $t('app.offline') }}
        </div>

        <RouterView v-slot="{ Component }">
          <component :is="Component" />
        </RouterView>
      </main>
    </div>

    <!-- Barra de reproducción (fuera del RouterView, persistente) -->
    <PlayerBar />

    <!-- IFrame de YouTube (invisible, instanciado una vez) -->
    <YouTubeFrame />

    <!-- Vista "Now Playing" a pantalla completa (solo móvil) -->
    <Transition name="np">
      <NowPlayingScreen v-if="ui.nowPlayingOpen" />
    </Transition>

    <!-- Panel de la cola de reproducción -->
    <Transition name="queue">
      <QueuePanel v-if="ui.queueOpen" />
    </Transition>

    <!-- Modales globales -->
    <CreatePlaylistModal v-if="ui.createPlaylistOpen" />
    <AddTrackModal v-if="ui.addTrackPlaylistId" />
    <CsvImportModal v-if="ui.csvImportPlaylistId" />
    <SaveToPlaylistModal v-if="ui.saveToPlaylistTrack || ui.saveToPlaylistTracks" />

    <!-- Toast -->
    <Transition name="toast">
      <div v-if="ui.toast"
           class="fixed bottom-28 left-1/2 -translate-x-1/2 z-50 px-4 py-2.5 rounded-xl text-sm shadow-xl border"
           :class="{
             'bg-card border-line text-white': ui.toast.kind === 'info',
             'bg-emerald-500/15 border-emerald-500/30 text-emerald-300': ui.toast.kind === 'success',
             'bg-red-500/15 border-red-500/30 text-red-300': ui.toast.kind === 'error'
           }">
        {{ ui.toast.message }}
      </div>
    </Transition>

    <!-- Aviso de actualización de la PWA (registerType: 'prompt') -->
    <PwaUpdatePrompt />

    <!-- Ayuda de atajos de teclado (tecla ?) -->
    <ShortcutsHelp v-if="showShortcuts" @close="showShortcuts = false" />
  </div>
</template>

<style>
.drawer-enter-active, .drawer-leave-active { transition: opacity .2s ease; }
.drawer-enter-from, .drawer-leave-to { opacity: 0; }
.toast-enter-active, .toast-leave-active { transition: all .25s ease; }
.toast-enter-from, .toast-leave-to { opacity: 0; transform: translate(-50%, 8px); }
.np-enter-active, .np-leave-active { transition: transform .28s ease, opacity .28s ease; }
.np-enter-from, .np-leave-to { opacity: 0; transform: translateY(100%); }
.queue-enter-active, .queue-leave-active { transition: opacity .2s ease; }
.queue-enter-active .queue-panel, .queue-leave-active .queue-panel { transition: transform .25s ease; }
.queue-enter-from, .queue-leave-to { opacity: 0; }
.queue-enter-from .queue-panel, .queue-leave-to .queue-panel { transform: translateX(100%); }
</style>
