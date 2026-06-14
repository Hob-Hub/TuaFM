import { ref, computed } from 'vue'
import { useYouTubePlayer } from '@/composables/useYouTubePlayer'

// Temporizador de apagado: pausa la reproducción al cumplirse N minutos. Estado
// singleton a nivel de módulo (como el player de YouTube): un único temporizador
// compartido por toda la app, no atado al ciclo de vida de ningún componente.
let interval: ReturnType<typeof setInterval> | null = null
const endAt = ref<number | null>(null)   // timestamp en ms, o null si inactivo
const now = ref(Date.now())

const STEPS = [15, 30, 45, 60] as const

export function useSleepTimer() {
  const yt = useYouTubePlayer()

  const active = computed(() => endAt.value !== null)
  const remainingMs = computed(() => (endAt.value ? Math.max(0, endAt.value - now.value) : 0))
  /** Minutos restantes redondeados hacia arriba, para etiqueta compacta (p. ej. "12"). */
  const remainingLabel = computed(() => Math.ceil(remainingMs.value / 60_000))

  function tick(): void {
    now.value = Date.now()
    if (endAt.value !== null && now.value >= endAt.value) {
      yt.pause()
      cancel()
    }
  }

  function start(minutes: number): void {
    cancel()
    now.value = Date.now()
    endAt.value = now.value + minutes * 60_000
    interval = setInterval(tick, 1000)
  }

  function cancel(): void {
    if (interval) { clearInterval(interval); interval = null }
    endAt.value = null
  }

  return { steps: STEPS, active, remainingMs, remainingLabel, start, cancel }
}
