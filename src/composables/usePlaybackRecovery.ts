import { watch } from 'vue'
import { i18n } from '@/i18n'
import type { Track } from '@/types/track.types'
import { usePlayerStore } from '@/stores/player.store'
import { useUiStore } from '@/stores/ui.store'
import { useYouTubePlayer } from '@/composables/useYouTubePlayer'
import { clearFailure, recordFailure } from '@/composables/useFailedTracks'

// Recuperación ante fallos de arranque de una pista, separada del orquestador.
// Dos mecanismos complementarios:
//   1) Candidatos: si el vídeo actual falla (privado, bloqueado, no embebible…)
//      se reintenta con el siguiente videoId antes de saltar de pista.
//   2) Watchdog: algunos vídeos ni reproducen ni emiten onError (autoplay
//      bloqueado en el iframe recién intercambiado, interstitial de consentimiento
//      o región, rebuffer infinito…). Si tras pedir reproducción el estado no
//      llega a 'playing' en este margen, se trata como fallo silencioso y se
//      reusa la misma ruta de recuperación.
const START_TIMEOUT_MS = 12000

// Estado de módulo: usePlayback es un singleton de facto, así que la pista en
// curso y su watchdog son únicos en la app.
let currentCandidates: string[] = []
let candidateIdx = 0
let startWatchdog: ReturnType<typeof setTimeout> | null = null
let watchdogWatcherSet = false

/** Lista de videoIds a intentar: el mejor primero, luego los alternativos. */
export function buildCandidates(track: Track): string[] {
  const list: string[] = []
  if (track.youtubeVideoId) list.push(track.youtubeVideoId)
  for (const c of track.youtubeCandidates ?? []) {
    if (!list.includes(c)) list.push(c)
  }
  return list
}

export interface RecoveryDeps {
  /** Pista en curso (cualquiera que sea el modo de cola). */
  currentTrack: () => Track | null
  /** ¿Hay siguiente pista a la que saltar si se agotan los candidatos? */
  hasNext: () => boolean
  /** Salta a la siguiente pista. */
  advance: () => Promise<void>
}

export function usePlaybackRecovery(deps: RecoveryDeps) {
  const player = usePlayerStore()
  const ui     = useUiStore()
  const yt     = useYouTubePlayer()

  // Desarma el watchdog en cuanto el reproductor sale de 'loading' (suena, se
  // pausa, termina…). Si se queda colgado en 'loading', salta el timer de armado.
  if (!watchdogWatcherSet) {
    watchdogWatcherSet = true
    watch(() => player.state, (s) => {
      if (s !== 'loading') clearWatchdog()
      if (s === 'playing') {
        const t = deps.currentTrack()
        if (t) void clearFailure(t)
      }
    })
  }

  function clearWatchdog(): void {
    if (startWatchdog) { clearTimeout(startWatchdog); startWatchdog = null }
  }

  function armWatchdog(): void {
    clearWatchdog()
    const armedFor = deps.currentTrack()?.id ?? null
    startWatchdog = setTimeout(() => {
      startWatchdog = null
      if (player.state === 'playing') return
      if (deps.currentTrack()?.id !== armedFor) return
      void handleError()
    }, START_TIMEOUT_MS)
  }

  /** Arranca una pista por su mejor candidato y vigila el arranque. */
  function startTrack(candidates: string[], trackId: string | null): void {
    currentCandidates = candidates
    candidateIdx = 0
    yt.loadAndPlay(candidates[0], trackId)
    armWatchdog()
  }

  /**
   * El iframe falló (o el watchdog detectó un arranque colgado): reintenta con el
   * siguiente candidato; si se agotan, avisa y salta de pista.
   */
  async function handleError(): Promise<void> {
    clearWatchdog()   // ya estamos gestionando un fallo; evita disparos solapados
    candidateIdx++
    if (candidateIdx < currentCandidates.length) {
      player.state = 'loading'
      yt.loadAndPlay(currentCandidates[candidateIdx], deps.currentTrack()?.id ?? null)
      armWatchdog()
      return
    }
    const t = deps.currentTrack()
    const label = t
      ? `${t.artistDisplay ?? t.artist} - ${t.titleDisplay ?? t.title}`
      : i18n.global.t('playback.thisTrack')
    ui.showToast(i18n.global.t('playback.cannotPlay', { label }), 'error')
    // Ningún candidato arrancó: guárdala para revisarla/arreglarla luego.
    if (t) void recordFailure(t, 'playback-error', currentCandidates, player.queueMode)
    if (deps.hasNext()) await deps.advance()
    else player.state = 'error'
  }

  return { startTrack, handleError, clearWatchdog }
}
