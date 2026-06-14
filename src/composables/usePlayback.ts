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
import { usePlaybackRecovery, buildCandidates } from '@/composables/usePlaybackRecovery'

// La cola de playlist vive ahora en usePlaylistQueueStore (persistida), no aquí.
let handlersBound = false
let enrichWatcherSet = false
let enrichInFlight = false

// Modo clips: la mecánica (salto al centro sin ruido + avance) vive en
// useYouTubePlayer; aquí solo reaccionamos a activarlo a media canción.
let clipWatcherSet = false

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

  // La cola activa según el modo. Las tres comparten interfaz (queueState), así
  // que casi todo el orquestador opera sobre `activeQueue` sin volver a abrir un
  // switch por modo; solo las reglas propias de un modo (repeat/shuffle de la
  // playlist, extensión de la radio) se tratan aparte.
  const activeQueue = computed(() => {
    switch (player.queueMode) {
      case 'radio':           return radio
      case 'recommendations': return rec
      case 'playlist':        return pq
      default:                return null
    }
  })

  const currentTrack = computed<Track | null>(() => activeQueue.value?.currentTrack ?? null)

  const hasNext = computed(() => {
    if (!activeQueue.value) return false
    if (player.queueMode === 'playlist') return player.repeatMode === 'all' || pq.hasNext
    return activeQueue.value.hasNext
  })

  const hasPrev = computed(() => activeQueue.value?.hasPrev ?? false)

  // Recuperación de fallos de arranque (candidatos alternativos + watchdog).
  const recovery = usePlaybackRecovery({
    currentTrack: () => currentTrack.value,
    hasNext:      () => hasNext.value,
    advance:      () => next(),
  })

  // Derivados de la cola activa para el panel de cola (antes QueuePanel.vue
  // reabría su propio switch por modo para obtener lo mismo).
  const queueTracks = computed<Track[]>(() => activeQueue.value?.queue ?? [])
  const queueIndex  = computed(() => activeQueue.value?.currentIndex ?? -1)
  const queueSourceLabel = computed(() => {
    switch (player.queueMode) {
      case 'radio':           return radio.sourceLabel || i18n.global.t('queue.radio')
      case 'recommendations': return i18n.global.t('queue.recommendations')
      case 'playlist':        return i18n.global.t('queue.playlist')
      default:                return ''
    }
  })

  /** Salta a un índice de la cola activa (el modo ya es el activo: panel de cola). */
  function playIndex(i: number): void {
    const q = activeQueue.value
    if (!q || i < 0 || i >= q.queue.length) return
    q.skipTo(i)
    void playCurrent()
  }

  /** Engancha los callbacks del reproductor una sola vez. */
  function bindHandlers(): void {
    if (handlersBound) return
    yt.onEnded(() => { void next() })
    yt.onClipEnd(() => { void next() })
    yt.onError(() => { void recovery.handleError() })
    setupMediaSessionHandlers()
    syncRealDuration()
    handlersBound = true
  }

  /**
   * Aplica cambios a una pista (por id) en la cola activa. Si es la playlist,
   * además los persiste en Dexie. Única vía para mutar una pista en curso, sea
   * cual sea el modo (antes había tres copias casi idénticas de este switch).
   */
  function patchTrack(id: string, data: Partial<Track>): void {
    const q = activeQueue.value
    if (!q) return
    q.updateTrack(id, data)
    if (player.queueMode === 'playlist') void persistPlaylistTrack(id, data)
  }

  /** Aplica cambios a la pista en curso (sea cual sea el modo de cola). */
  function updateCurrentTrack(data: Partial<Track>): void {
    const t = currentTrack.value
    if (t) patchTrack(t.id, data)
  }

  /** Marca una pista como enriquecida y guarda sus metadatos resueltos. */
  function applyEnrichment(track: Track, data: Partial<Track>): void {
    patchTrack(track.id, { ...data, enriched: true })
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

    const candidates = buildCandidates(track)

    if (candidates.length > 0) {
      recovery.startTrack(candidates, track.id)
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

  // Puntos de entrada que fijan el modo y arrancan (desde Inicio, Radio, Recs).
  // Para saltar dentro de la cola ya activa está playIndex (panel de cola).
  function playRadioIndex(i: number): void { radio.skipTo(i); player.queueMode = 'radio'; void playCurrent() }
  function playRecIndex(i: number): void   { rec.skipTo(i);   player.queueMode = 'recommendations'; void playCurrent() }

  /** Radio infinita: si quedan pocas pistas por delante, precarga más en 2º plano. */
  function maybePrefetchRadio(): void {
    if (player.queueMode !== 'radio') return
    const remaining = radio.queue.length - radio.currentIndex - 1
    if (remaining <= 5) void extendRadio()
  }

  /** Pista que sonaría al pulsar "siguiente" (no predecible en aleatorio). */
  function peekNextTrack(): Track | null {
    if (player.queueMode === 'playlist' && player.isShuffle) return null
    const q = activeQueue.value
    return q ? q.queue[q.currentIndex + 1] ?? null : null
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
      applyEnrichment(t, data)
      t = peekNextTrack()
      if (!t) return
    }
    const cands = buildCandidates(t)
    if (cands.length) yt.preload(cands[0])
  }

  // ── Navegación ──────────────────────────────────────────────────────────────
  async function next(): Promise<void> {
    // La playlist tiene reglas propias (shuffle/repeat); radio y recomendaciones
    // avanzan genéricamente, y solo la radio intenta extenderse al agotarse.
    if (player.queueMode === 'playlist') { await playlistNext(); return }

    const q = activeQueue.value
    if (!q) return
    if (q.hasNext) { q.next(); await playCurrent(); return }

    if (player.queueMode === 'radio') {
      // Fin de la cola: intenta extender la radio antes de darla por acabada.
      const added = await extendRadio()
      if (added && radio.hasNext) { radio.next(); await playCurrent(); return }
    }
    player.state = 'ended'
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
    const q = activeQueue.value
    if (!q) return
    if (q.hasPrev) { q.prev(); await playCurrent() }
    else yt.seekTo(0)   // ya en la primera: reinicia desde el principio
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
    queueTracks, queueIndex, queueSourceLabel, playIndex,
    playCurrent, startPlaylistQueue, playPlaylistById,
    playRadioIndex, playRecIndex,
    next, prev, togglePlay
  }
}
