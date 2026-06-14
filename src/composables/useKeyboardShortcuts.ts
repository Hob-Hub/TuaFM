import { ref, onMounted, onBeforeUnmount } from 'vue'
import { usePlayerStore } from '@/stores/player.store'
import { usePlayback } from '@/composables/usePlayback'
import { useYouTubePlayer } from '@/composables/useYouTubePlayer'
import { useFavorites } from '@/composables/useFavorites'

const SEEK_STEP = 5   // segundos por pulsación de ←/→

/**
 * Atajos de teclado globales del reproductor:
 *   Espacio = play/pausa · ←/→ = seek ±5s · Shift+←/→ = pista anterior/siguiente
 *   M = silenciar · F = favorito · ? = abre/cierra la ayuda
 * Se ignoran si el foco está en un campo de texto. Engancha y suelta el listener
 * con el ciclo de vida del componente que lo use.
 *
 * Devuelve `showShortcuts` para que el host pinte el overlay de ayuda.
 */
export function useKeyboardShortcuts() {
  const player   = usePlayerStore()
  const playback = usePlayback()
  const yt       = useYouTubePlayer()
  const { toggleFavorite } = useFavorites()
  const showShortcuts = ref(false)

  function onKey(e: KeyboardEvent): void {
    const tag = (e.target as HTMLElement)?.tagName
    if (tag === 'INPUT' || tag === 'TEXTAREA') return
    // Con la ayuda abierta, solo permitimos cerrarla (Escape lo gestiona el modal).
    if (showShortcuts.value && e.key !== '?') return
    if (e.key === '?') { e.preventDefault(); showShortcuts.value = !showShortcuts.value; return }
    switch (e.code) {
      case 'Space':      e.preventDefault(); playback.togglePlay(); break
      case 'ArrowRight': e.preventDefault(); if (e.shiftKey) playback.next(); else yt.seekTo(player.currentTime + SEEK_STEP); break
      case 'ArrowLeft':  e.preventDefault(); if (e.shiftKey) playback.prev(); else yt.seekTo(Math.max(0, player.currentTime - SEEK_STEP)); break
      case 'KeyM':       yt.toggleMute(); break
      case 'KeyF':       { const t = playback.currentTrack.value; if (t) void toggleFavorite(t); break }
    }
  }

  onMounted(() => document.addEventListener('keydown', onKey))
  onBeforeUnmount(() => document.removeEventListener('keydown', onKey))

  return { showShortcuts }
}
