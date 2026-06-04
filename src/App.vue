<script setup lang="ts">
import { onMounted, onBeforeUnmount } from 'vue'
import { RouterView } from 'vue-router'
import { useOnline } from '@vueuse/core'
import { useUiStore } from '@/stores/ui.store'
import { usePlayback } from '@/composables/usePlayback'
import AppSidebar from '@/components/layout/AppSidebar.vue'
import PlayerBar from '@/components/layout/PlayerBar.vue'
import YouTubeFrame from '@/components/player/YouTubeFrame.vue'
import CreatePlaylistModal from '@/components/playlist/CreatePlaylistModal.vue'
import AddTrackModal from '@/components/playlist/AddTrackModal.vue'
import CsvImportModal from '@/components/playlist/CsvImportModal.vue'
import SaveToPlaylistModal from '@/components/playlist/SaveToPlaylistModal.vue'

const ui = useUiStore()
const online = useOnline()
const playback = usePlayback()

// Atajos de teclado globales: espacio = play/pausa, ←/→ = seek ±5s
function onKey(e: KeyboardEvent): void {
  const tag = (e.target as HTMLElement)?.tagName
  if (tag === 'INPUT' || tag === 'TEXTAREA') return
  if (e.code === 'Space') { e.preventDefault(); playback.togglePlay() }
  else if (e.code === 'ArrowRight' && e.shiftKey) { e.preventDefault(); playback.next() }
  else if (e.code === 'ArrowLeft'  && e.shiftKey) { e.preventDefault(); playback.prev() }
}
onMounted(() => document.addEventListener('keydown', onKey))
onBeforeUnmount(() => document.removeEventListener('keydown', onKey))
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
      <main class="min-h-0 overflow-y-auto">
        <!-- Topbar móvil -->
        <div class="md:hidden sticky top-0 z-10 h-14 flex items-center gap-3 px-4 bg-surface/90 backdrop-blur border-b border-line">
          <button class="p-2 -ml-2 rounded-lg text-white" aria-label="Abrir menú" @click="ui.toggleSidebar()">
            <svg viewBox="0 0 24 24" class="w-6 h-6" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 6h16M4 12h16M4 18h16"/></svg>
          </button>
          <span class="font-display font-extrabold">Tua<span class="text-brand">FM</span></span>
        </div>

        <!-- Banner offline -->
        <div v-if="!online" class="bg-amber-500/15 text-amber-300 text-sm px-4 py-2 text-center border-b border-amber-500/20">
          Sin conexión — tus playlists locales funcionan; radio y recomendaciones requieren internet.
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

    <!-- Modales globales -->
    <CreatePlaylistModal v-if="ui.createPlaylistOpen" />
    <AddTrackModal v-if="ui.addTrackPlaylistId" />
    <CsvImportModal v-if="ui.csvImportPlaylistId" />
    <SaveToPlaylistModal v-if="ui.saveToPlaylistTrack" />

    <!-- Toast -->
    <Transition name="toast">
      <div v-if="ui.toast"
           class="fixed bottom-24 left-1/2 -translate-x-1/2 z-50 px-4 py-2.5 rounded-xl text-sm shadow-xl border"
           :class="{
             'bg-card border-line text-white': ui.toast.kind === 'info',
             'bg-emerald-500/15 border-emerald-500/30 text-emerald-300': ui.toast.kind === 'success',
             'bg-red-500/15 border-red-500/30 text-red-300': ui.toast.kind === 'error'
           }">
        {{ ui.toast.message }}
      </div>
    </Transition>
  </div>
</template>

<style>
.drawer-enter-active, .drawer-leave-active { transition: opacity .2s ease; }
.drawer-enter-from, .drawer-leave-to { opacity: 0; }
.toast-enter-active, .toast-leave-active { transition: all .25s ease; }
.toast-enter-from, .toast-leave-to { opacity: 0; transform: translate(-50%, 8px); }
</style>
