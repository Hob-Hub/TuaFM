import { computed, watch } from 'vue'
import { i18n } from '@/i18n'
import type { Track } from '@/types/track.types'
import { usePlayerStore } from '@/stores/player.store'
import { useRadioStore } from '@/stores/radio.store'
import { useRecommendationsStore } from '@/stores/recommendations.store'
import { usePlaylistQueueStore } from '@/stores/playlistQueue.store'
import { useUiStore } from '@/stores/ui.store'
import { useYouTubePlayer } from '@/composables/useYouTubePlayer'
import { useTrackEnrich } from '@/composables/useTrackEnrich'
import { usePlayHistory } from '@/composables/usePlayHistory'
import { usePlaylists } from '@/composables/usePlaylists'
import { useRadioQueue } from '@/composables/useRadioQueue'

// La cola de playlist vive ahora en usePlaylistQueueStore (persistida), no aquí.
let handlersBound = false
let enrichWatcherSet = false
let enrichInFlight = false

// Modo clips: la mecánica (salto al centro sin ruido + avance) vive en
// useYouTubePlayer; aquí solo reaccionamos a activarlo a media canción.
let clipWatcherSet = false

// Candidatos de YouTube de la pista en curso, para reintentar en onError.
let currentCandidates: string[] = []
let candidateIdx = 0

// Watchdog de arranque: algunos vídeos ni reproducen ni emiten onError (autoplay
// bloqueado en el iframe recién intercambiado, interstitial de consentimiento/
// región, rebuffer infinito…). Si tras pedir reproducción el estado no llega a
// 'playing' en este margen, lo tratamos como fallo y avanzamos. Antes el
// reproductor se quedaba colgado para siempre porque solo recuperaba ante onError.
const START_TIMEOUT_MS = 12000
let startWatchdog: ReturnType<typeof setTimeout> | null = null
let watchdogWatcherSet = false

/**
 * Orquestador central de reproducción. Unifica los tres modos (playlist, radio,
 * recommendations) sobre el reproductor YouTube. Es el único sitio que sabe
 * "qué suena ahora" y cómo avanzar/retroceder.
 */
export function usePlayback() {
  const player = usePlayerStore()
  const radio  = useRadioStore()
  const rec    = useRecommendationsStore()
  const pq     = usePlaylistQueueStore()
  const ui     = useUiStore()
  const yt     = useYouTubePlayer()
  const { enrich } = useTrackEnrich()
  const { recordPlay } = usePlayHistory()
  const { updateTrack: persistPlaylistTrack, getTracks } = usePlaylists()
  const { extend: extendRadio } = useRadioQueue()

  setupQueueEnrichment()
  setupClipMode()
  setupStartWatchdog()

  /**
   * Modo clips (escucha rápida): el salto al centro sin ruido y el avance al final
   * del trozo los gobierna useYouTubePlayer (acceso síncrono al player y sus
   * eventos). Aquí solo reaccionamos a *activar* el modo a media canción para
   * recolocar la pista que ya suena en su centro.
   */
  function setupClipMode(): void {
    if (clipWatcherSet) return
    clipWatcherSet = true
    watch(() => player.clipMode, (on) => { if (on) yt.repositionCurrentClip() })
  }

  /**
   * Vigila el arranque de cada pista: en cuanto el reproductor sale de 'loading'
   * (suena, se pausa, termina…) desarma el watchdog; si se queda colgado en
   * 'loading', el timer de `armStartWatchdog` salta y dispara la recuperación.
   */
  function setupStartWatchdog(): void {
    if (watchdogWatcherSet) return
    watchdogWatcherSet = true
    watch(() => player.state, (s) => {
      if (s !== 'loading') clearStartWatchdog()
    })
  }

  function clearStartWatchdog(): void {
    if (startWatchdog) { clearTimeout(startWatchdog); startWatchdog = null }
  }

  /**
   * Arma el watchdog tras pedir reproducción de una pista. Si pasado el margen
   * seguimos sin sonar y sigue siendo la misma pista, lo tratamos como un fallo
   * silencioso y reutilizamos la ruta de error (siguiente candidato → saltar).
   */
  function armStartWatchdog(): void {
    clearStartWatchdog()
    const armedFor = currentTrack.value?.id ?? null
    startWatchdog = setTimeout(() => {
      startWatchdog = null
      if (player.state === 'playing') return
      if (currentTrack.value?.id !== armedFor) return
      void handlePlaybackError()
    }, START_TIMEOUT_MS)
  }

  /**
   * Enriquece la cola de radio en segundo plano para que carátulas, tags y
   * duraciones salgan de forma consistente (no solo en la pista que ya sonó).
   * El enriquecimiento es "catálogo primero" (local), así que es barato.
   */
  function setupQueueEnrichment(): void {
    if (enrichWatcherSet) return
    enrichWatcherSet = true
    watch(() => radio.queue.length, () => { void enrichRadioQueueBg() }, { immediate: true })
  }

  async function enrichRadioQueueBg(): Promise<void> {
    if (enrichInFlight) return
    enrichInFlight = true
    try {
      for (const t of [...radio.queue]) {
        if (t.enriched) continue
        const data = await enrich(t)
        radio.updateTrack(t.id, { ...data, enriched: true })
      }
    } finally {
      enrichInFlight = false
    }
  }

  const currentTrack = computed<Track | null>(() => {
    switch (player.queueMode) {
      case 'radio':           return radio.currentTrack
      case 'recommendations': return rec.currentTrack
      case 'playlist':        return pq.currentTrack
      default:                return null
    }
  })

  const hasNext = computed(() => {
    switch (player.queueMode) {
      case 'radio':           return radio.hasNext
      case 'recommendations': return rec.hasNext
      case 'playlist':        return player.repeatMode === 'all' || pq.hasNext
      default:                return false
    }
  })

  const hasPrev = computed(() => {
    switch (player.queueMode) {
      case 'radio':           return radio.hasPrev
      case 'recommendations': return rec.hasPrev
      case 'playlist':        return pq.hasPrev
      default:                return false
    }
  })

  /** Engancha los callbacks del reproductor una sola vez. */
  function bindHandlers(): void {
    if (handlersBound) return
    yt.onEnded(() => { void next() })
    yt.onClipEnd(() => { void next() })
    yt.onError(() => { void handlePlaybackError() })
    setupMediaSessionHandlers()
    syncRealDuration()
    handlersBound = true
  }

  /** Actualiza datos de la pista en curso (sea cual sea el modo de cola). */
  function updateCurrentTrack(data: Partial<Track>): void {
    const t = currentTrack.value
    if (!t) return
    switch (player.queueMode) {
      case 'radio':           radio.updateTrack(t.id, data); break
      case 'recommendations': rec.updateTrack(t.id, data); break
      case 'playlist':
        pq.updateTrack(t.id, data)
        void persistPlaylistTrack(t.id, data)
        break
    }
  }

  /**
   * La duración del catálogo (Last.fm) y la del vídeo de YouTube no siempre
   * coinciden. Cuando YouTube reporta la duración real, la guardamos en la pista
   * para que la cola muestre el dato coherente con lo que de verdad suena.
   */
  function syncRealDuration(): void {
    watch(() => player.duration, (d) => {
      if (d <= 0) return
      const t = currentTrack.value
      if (!t) return
      const ms = Math.round(d * 1000)
      if (!t.duration || Math.abs(t.duration - ms) > 1500) updateCurrentTrack({ duration: ms })
    })
  }

  /**
   * Registra los controles del SO (pantalla de bloqueo, teclas multimedia) una
   * sola vez con callbacks estables. Antes se re-registraban en cada pista; al
   * fijarlos pronto y de forma estable, los botones de anterior/siguiente del SO
   * funcionan de manera fiable, no solo play/pausa.
   */
  function setupMediaSessionHandlers(): void {
    if (!('mediaSession' in navigator)) return
    const ms = navigator.mediaSession
    const safe = (action: MediaSessionAction, handler: MediaSessionActionHandler): void => {
      try { ms.setActionHandler(action, handler) } catch { /* acción no soportada */ }
    }
    safe('play',  () => yt.play())
    safe('pause', () => yt.pause())
    safe('previoustrack', () => { void prev() })
    safe('nexttrack',     () => { void next() })
    safe('seekbackward', d => yt.seekTo(Math.max(0, player.currentTime - (d.seekOffset ?? 10))))
    safe('seekforward',  d => yt.seekTo(player.currentTime + (d.seekOffset ?? 10)))
    safe('seekto', d => { if (d.seekTime != null) yt.seekTo(d.seekTime) })
  }

  /** Lista de videoIds a intentar: el mejor primero, luego los alternativos. */
  function buildCandidates(track: Track): string[] {
    const list: string[] = []
    if (track.youtubeVideoId) list.push(track.youtubeVideoId)
    for (const c of track.youtubeCandidates ?? []) {
      if (!list.includes(c)) list.push(c)
    }
    return list
  }

  /**
   * El iframe falló en el vídeo actual (privado, bloqueado, no embebible…).
   * Reintenta con el siguiente candidato; si se agotan, salta de pista.
   */
  async function handlePlaybackError(): Promise<void> {
    clearStartWatchdog()   // ya estamos gestionando un fallo; evita disparos solapados
    candidateIdx++
    if (candidateIdx < currentCandidates.length) {
      player.state = 'loading'
      yt.loadAndPlay(currentCandidates[candidateIdx], currentTrack.value?.id ?? null)
      armStartWatchdog()
      return
    }
    const t = currentTrack.value
    const label = t ? `${t.artistDisplay ?? t.artist} - ${t.titleDisplay ?? t.title}` : i18n.global.t('playback.thisTrack')
    ui.showToast(i18n.global.t('playback.cannotPlay', { label }), 'error')
    if (hasNext.value) await next()
    else player.state = 'error'
  }

  function applyEnrichment(track: Track, data: Partial<Track>): void {
    const merged = { ...data, enriched: true }
    switch (player.queueMode) {
      case 'radio':           radio.updateTrack(track.id, merged); break
      case 'recommendations': rec.updateTrack(track.id, merged); break
      case 'playlist':
        pq.updateTrack(track.id, merged)
        void persistPlaylistTrack(track.id, merged)
        break
    }
  }

  /** Actualiza los metadatos del SO (título, artista, carátula) de la pista. */
  function updateMediaSession(track: Track): void {
    if (!('mediaSession' in navigator)) return
    navigator.mediaSession.metadata = new MediaMetadata({
      title:  track.titleDisplay ?? track.title,
      artist: track.artistDisplay ?? track.artist,
      album:  track.album ?? '',
      artwork: track.coverUrl ? [{ src: track.coverUrl, sizes: '512x512' }] : []
    })
  }

  /** Carga y reproduce la pista activa, enriqueciéndola lazy si hace falta. */
  async function playCurrent(): Promise<void> {
    bindHandlers()
    let track = currentTrack.value
    if (!track) return

    if (!track.youtubeVideoId || !track.enriched) {
      const data = await enrich(track)
      applyEnrichment(track, data)
      track = currentTrack.value
    }
    if (!track) return

    currentCandidates = buildCandidates(track)
    candidateIdx = 0

    if (currentCandidates.length > 0) {
      yt.loadAndPlay(currentCandidates[0], track.id)
      armStartWatchdog()
      player.currentTrackId = track.id
      updateMediaSession(track)
      void recordPlay(track, player.queueMode)
      maybePrefetchRadio()
      void prefetchNext()
    } else {
      player.state = 'error'
      ui.showToast(i18n.global.t('playback.noVideo', { track: `${track.artistDisplay ?? track.artist} - ${track.titleDisplay ?? track.title}` }), 'error')
      // Intentar saltar a la siguiente automáticamente
      if (hasNext.value) await next()
    }
  }

  // ── Arranque de cada modo ──────────────────────────────────────────────────
  function startPlaylistQueue(tracks: Track[], startIndex: number, playlistId: string | null): void {
    pq.setQueue(tracks, startIndex, playlistId)
    player.queueMode = 'playlist'
    void playCurrent()
  }

  /** Carga la playlist desde Dexie y la reproduce desde un índice dado. */
  async function playPlaylistById(playlistId: string, startIndex = 0): Promise<void> {
    const { getPlaylist } = usePlaylists()
    const pl = await getPlaylist(playlistId)
    if (!pl) return
    const tracks = await getTracks(pl)
    if (tracks.length === 0) { ui.showToast(i18n.global.t('playback.emptyPlaylist'), 'info'); return }
    startPlaylistQueue(tracks, startIndex, playlistId)
  }

  function playRadioIndex(i: number): void   { radio.skipTo(i); player.queueMode = 'radio'; void playCurrent() }
  function playRecIndex(i: number): void      { rec.skipTo(i);   player.queueMode = 'recommendations'; void playCurrent() }

  /** Salta a un índice de la cola de playlist efímera ya en curso. */
  function playPlaylistIndex(i: number): void {
    if (i < 0 || i >= pq.queue.length) return
    pq.skipTo(i)
    player.queueMode = 'playlist'
    void playCurrent()
  }

  /** Radio infinita: si quedan pocas pistas por delante, precarga más en 2º plano. */
  function maybePrefetchRadio(): void {
    if (player.queueMode !== 'radio') return
    const remaining = radio.queue.length - radio.currentIndex - 1
    if (remaining <= 5) void extendRadio()
  }

  /** Pista que sonaría al pulsar "siguiente" (no predecible en aleatorio). */
  function peekNextTrack(): Track | null {
    switch (player.queueMode) {
      case 'radio':           return radio.queue[radio.currentIndex + 1] ?? null
      case 'recommendations': return rec.queue[rec.currentIndex + 1] ?? null
      case 'playlist':
        if (player.isShuffle) return null
        return pq.queue[pq.currentIndex + 1] ?? null
      default:                return null
    }
  }

  /** Aplica enriquecimiento a una pista concreta (por id) en su cola. */
  function applyEnrichmentToTrack(track: Track, data: Partial<Track>): void {
    const merged = { ...data, enriched: true }
    switch (player.queueMode) {
      case 'radio':           radio.updateTrack(track.id, merged); break
      case 'recommendations': rec.updateTrack(track.id, merged); break
      case 'playlist':
        pq.updateTrack(track.id, merged)
        void persistPlaylistTrack(track.id, merged)
        break
    }
  }

  /**
   * Prepara la SIGUIENTE pista: la resuelve (vídeo + metadatos, caché de Dexie) y
   * la **pre-bufferiza** en el player en standby. Así al pulsar "siguiente" el
   * salto es casi instantáneo (gapless), sin la espera de red ni el buffering.
   */
  async function prefetchNext(): Promise<void> {
    let t = peekNextTrack()
    if (!t) return
    if (!t.youtubeVideoId || !t.enriched) {
      const data = await enrich(t).catch(() => null)
      if (!data) return
      applyEnrichmentToTrack(t, data)
      t = peekNextTrack()
      if (!t) return
    }
    const cands = buildCandidates(t)
    if (cands.length) yt.preload(cands[0])
  }

  // ── Navegación ──────────────────────────────────────────────────────────────
  async function next(): Promise<void> {
    switch (player.queueMode) {
      case 'radio':
        if (radio.hasNext) { radio.next(); await playCurrent() }
        else {
          // Fin de la cola: intenta extender la radio antes de darla por acabada.
          const added = await extendRadio()
          if (added && radio.hasNext) { radio.next(); await playCurrent() }
          else player.state = 'ended'
        }
        return
      case 'recommendations':
        if (rec.hasNext) { rec.next(); await playCurrent() }
        else player.state = 'ended'
        return
      case 'playlist':
        await playlistNext()
        return
    }
  }

  async function playlistNext(): Promise<void> {
    if (player.repeatMode === 'one') { yt.seekTo(0); yt.play(); return }

    let idx: number
    if (player.isShuffle && pq.queue.length > 1) {
      do { idx = Math.floor(Math.random() * pq.queue.length) }
      while (idx === pq.currentIndex)
    } else {
      idx = pq.currentIndex + 1
    }

    if (idx >= pq.queue.length) {
      if (player.repeatMode === 'all') idx = 0
      else { player.state = 'ended'; return }
    }
    pq.skipTo(idx)
    await playCurrent()
  }

  async function prev(): Promise<void> {
    // En modo clips, "atrás" rescata la pista actual para oírla ENTERA (desde el
    // principio); las siguientes vuelven a sonar en clips.
    if (player.clipMode) { yt.playCurrentFull(); return }
    // Si llevamos >3s, reiniciar la pista en lugar de ir a la anterior
    if (player.currentTime > 3) { yt.seekTo(0); return }
    switch (player.queueMode) {
      case 'radio':           if (radio.hasPrev) { radio.prev(); await playCurrent() } return
      case 'recommendations': if (rec.hasPrev)   { rec.prev();   await playCurrent() } return
      case 'playlist':
        if (pq.hasPrev) { pq.skipTo(pq.currentIndex - 1); await playCurrent() }
        else yt.seekTo(0)
        return
    }
  }

  function togglePlay(): void {
    // Si no hay vídeo cargado todavía (radio reanudada al abrir, o cola lista sin
    // arrancar), el play debe cargar la pista actual, no solo "reanudar" la nada.
    if ((player.state === 'idle' || player.state === 'ended') && currentTrack.value) {
      void playCurrent()
      return
    }
    yt.toggle()
  }

  return {
    currentTrack, hasNext, hasPrev,
    playCurrent, startPlaylistQueue, playPlaylistById,
    playRadioIndex, playRecIndex, playPlaylistIndex,
    next, prev, togglePlay
  }
}
