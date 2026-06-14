import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { Track } from '@/types/track.types'

/**
 * Estado de UI transversal: sidebar móvil, modales y banners.
 * No se persiste — es estado puramente de presentación de la sesión actual.
 */
export const useUiStore = defineStore('ui', () => {
  const sidebarOpen = ref(false)              // drawer en móvil

  // Modal: crear playlist
  const createPlaylistOpen = ref(false)

  // Modal: importar CSV (en una playlist concreta)
  const csvImportPlaylistId = ref<string | null>(null)

  // Modal: añadir track (búsqueda Last.fm) a una playlist
  const addTrackPlaylistId = ref<string | null>(null)

  // Modal: guardar pistas en una playlist destino. Siempre un lote (una pista
  // suelta es un lote de 1); `saveToPlaylistLabel` describe el lote (un Top, una
  // radio, unos resultados) o queda null para una sola pista (se muestra su ficha).
  const saveToPlaylistTracks = ref<Track[] | null>(null)
  const saveToPlaylistLabel = ref<string | null>(null)

  // Vista "Now Playing" a pantalla completa (principalmente móvil)
  const nowPlayingOpen = ref(false)

  // Panel de la cola de reproducción
  const queueOpen = ref(false)

  // Toast / banner de error global (efímero)
  const toast = ref<{ message: string; kind: 'error' | 'info' | 'success' } | null>(null)
  let toastTimer: ReturnType<typeof setTimeout> | null = null

  function openNowPlaying()  { nowPlayingOpen.value = true }
  function closeNowPlaying() { nowPlayingOpen.value = false }

  function openQueue()   { queueOpen.value = true }
  function closeQueue()  { queueOpen.value = false }
  function toggleQueue() { queueOpen.value = !queueOpen.value }

  function openSidebar()  { sidebarOpen.value = true }
  function closeSidebar() { sidebarOpen.value = false }
  function toggleSidebar() { sidebarOpen.value = !sidebarOpen.value }

  function openCreatePlaylist()  { createPlaylistOpen.value = true }
  function closeCreatePlaylist() { createPlaylistOpen.value = false }

  function openCsvImport(playlistId: string)  { csvImportPlaylistId.value = playlistId }
  function closeCsvImport() { csvImportPlaylistId.value = null }

  function openAddTrack(playlistId: string) { addTrackPlaylistId.value = playlistId }
  function closeAddTrack() { addTrackPlaylistId.value = null }

  function openSaveToPlaylist(track: Track) {
    saveToPlaylistTracks.value = [track]
    saveToPlaylistLabel.value = null
  }
  function openSaveTracksToPlaylist(tracks: Track[], label?: string) {
    saveToPlaylistTracks.value = tracks
    saveToPlaylistLabel.value = label ?? null
  }
  function closeSaveToPlaylist() {
    saveToPlaylistTracks.value = null
    saveToPlaylistLabel.value = null
  }

  function showToast(message: string, kind: 'error' | 'info' | 'success' = 'info', ms = 4000) {
    toast.value = { message, kind }
    if (toastTimer) clearTimeout(toastTimer)
    toastTimer = setTimeout(() => { toast.value = null }, ms)
  }

  return {
    sidebarOpen, createPlaylistOpen, csvImportPlaylistId, addTrackPlaylistId,
    saveToPlaylistTracks, saveToPlaylistLabel,
    toast, nowPlayingOpen, queueOpen,
    openNowPlaying, closeNowPlaying,
    openQueue, closeQueue, toggleQueue,
    openSidebar, closeSidebar, toggleSidebar,
    openCreatePlaylist, closeCreatePlaylist,
    openCsvImport, closeCsvImport,
    openAddTrack, closeAddTrack,
    openSaveToPlaylist, openSaveTracksToPlaylist, closeSaveToPlaylist,
    showToast
  }
})
