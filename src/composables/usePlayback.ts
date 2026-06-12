import { ref, computed, watch } from 'vue'
import type { Track } from '@/types/track.types'
import { usePlayerStore } from '@/stores/player.store'
import { useRadioStore } from '@/stores/radio.store'
import { useRecommendationsStore } from '@/stores/recommendations.store'
import { useUiStore } from '@/stores/ui.store'
import { useYouTubePlayer } from '@/composables/useYouTubePlayer'
import { useTrackEnrich } from '@/composables/useTrackEnrich'
import { usePlayHistory } from '@/composables/usePlayHistory'
import { usePlaylists } from '@/composables/usePlaylists'
import { useRadioQueue } from '@/composables/useRadioQueue'

// ── Cola de playlist: estado singleton efímero (no persistido) ───────────────
const playlistQueue = ref<Track[]>([])
const playlistIndex = ref(0)
let handlersBound = false
let enrichWatcherSet = false
let enrichInFlight = false

// Modo clips: a qué pista se le aplicó ya el salto al centro, y desde qué segundo.
let clipWatcherSet = false
let clipAppliedFor: string | null = null
let clipStart = 0

// Candidatos de YouTube de la pista en curso, para reintentar en onError.
let currentCandidates: string[] = []
let candidateIdx = 0

/**
 * Orquestador central de reproducción. Unifica los tres modos (playlist, radio,
 * recommendations) sobre el reproductor YouTube. Es el único sitio que sabe
 * "qué suena ahora" y cómo avanzar/retroceder.
 */
export function usePlayback() {
  const player = usePlayerStore()
  const radio  = useRadioStore()
  const rec    = useRecommendationsStore()
  const ui     = useUiStore()
  const yt     = useYouTubePlayer()
  const { enrich } = useTrackEnrich()
  const { recordPlay } = usePlayHistory()
  const { updateTrack: persistPlaylistTrack, getTracks } = usePlaylists()
  const { extend: extendRadio } = useRadioQueue()

  setupQueueEnrichment()
  setupClipMode()

  /**
   * Modo clips (escucha rápida): cuando está activo, salta al centro de cada
   * canción y avanza tras `clipSeconds`. Todo se gobierna desde un único watcher
   * del tiempo (que avanza solo cuando suena, así respeta pausas): aplica el salto
   * una vez por pista (con la duración ya fiable porque está 'playing') y, una vez
   * aplicado, dispara el avance al llegar al final del trozo.
   */
  function setupClipMode(): void {
    if (clipWatcherSet) return
    clipWatcherSet = true
    watch(() => player.currentTime, (t) => {
      if (!player.clipMode) { clipAppliedFor = null; return }
      const id = player.currentTrackId
      if (!id || player.state !== 'playing') return

      if (clipAppliedFor !== id) {
        const d = player.duration
        if (d <= 0) return
        const n = player.clipSeconds
        clipStart = Math.min(Math.max(d / 2 - n / 2, 0), Math.max(0, d - n))
        clipAppliedFor = id
        if (Math.abs(t - clipStart) > 1) yt.seekTo(clipStart)   // salta al centro
        return
      }
      if (t >= clipStart + player.clipSeconds) {
        clipAppliedFor = null    // evita doble avance hasta que cargue la siguiente
        void next()
      }
    })
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
      case 'playlist':        return playlistQueue.value[playlistIndex.value] ?? null
      default:                return null
    }
  })

  const hasNext = computed(() => {
    switch (player.queueMode) {
      case 'radio':           return radio.hasNext
      case 'recommendations': return rec.hasNext
      case 'playlist':        return player.repeatMode === 'all' || playlistIndex.value < playlistQueue.value.length - 1
      default:                return false
    }
  })

  const hasPrev = computed(() => {
    switch (player.queueMode) {
      case 'radio':           return radio.hasPrev
      case 'recommendations': return rec.hasPrev
      case 'playlist':        return playlistIndex.value > 0
      default:                return false
    }
  })

  /** Engancha los callbacks del reproductor una sola vez. */
  function bindHandlers(): void {
    if (handlersBound) return
    yt.onEnded(() => { void next() })
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
        playlistQueue.value[playlistIndex.value] = { ...t, ...data }
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
    candidateIdx++
    if (candidateIdx < currentCandidates.length) {
      player.state = 'loading'
      yt.loadAndPlay(currentCandidates[candidateIdx])
      return
    }
    const t = currentTrack.value
    const label = t ? `${t.artistDisplay ?? t.artist} - ${t.titleDisplay ?? t.title}` : 'la pista'
    ui.showToast(`No se pudo reproducir "${label}"`, 'error')
    if (hasNext.value) await next()
    else player.state = 'error'
  }

  function applyEnrichment(track: Track, data: Partial<Track>): void {
    const merged = { ...data, enriched: true }
    switch (player.queueMode) {
      case 'radio':           radio.updateTrack(track.id, merged); break
      case 'recommendations': rec.updateTrack(track.id, merged); break
      case 'playlist':
        playlistQueue.value[playlistIndex.value] = { ...track, ...merged }
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
      yt.loadAndPlay(currentCandidates[0])
      player.currentTrackId = track.id
      updateMediaSession(track)
      void recordPlay(track, player.queueMode)
      maybePrefetchRadio()
      void prefetchNext()
    } else {
      player.state = 'error'
      ui.showToast(`No se encontró vídeo para "${track.artistDisplay ?? track.artist} - ${track.titleDisplay ?? track.title}"`, 'error')
      // Intentar saltar a la siguiente automáticamente
      if (hasNext.value) await next()
    }
  }

  // ── Arranque de cada modo ──────────────────────────────────────────────────
  function startPlaylistQueue(tracks: Track[], startIndex: number, playlistId: string | null): void {
    playlistQueue.value = tracks
    playlistIndex.value = Math.max(0, Math.min(startIndex, tracks.length - 1))
    player.queueMode = 'playlist'
    player.currentPlaylistId = playlistId
    void playCurrent()
  }

  /** Carga la playlist desde Dexie y la reproduce desde un índice dado. */
  async function playPlaylistById(playlistId: string, startIndex = 0): Promise<void> {
    const { getPlaylist } = usePlaylists()
    const pl = await getPlaylist(playlistId)
    if (!pl) return
    const tracks = await getTracks(pl)
    if (tracks.length === 0) { ui.showToast('La playlist está vacía', 'info'); return }
    startPlaylistQueue(tracks, startIndex, playlistId)
  }

  function playRadioIndex(i: number): void   { radio.skipTo(i); player.queueMode = 'radio'; void playCurrent() }
  function playRecIndex(i: number): void      { rec.skipTo(i);   player.queueMode = 'recommendations'; void playCurrent() }

  /** Salta a un índice de la cola de playlist efímera ya en curso. */
  function playPlaylistIndex(i: number): void {
    if (i < 0 || i >= playlistQueue.value.length) return
    playlistIndex.value = i
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
        return playlistQueue.value[playlistIndex.value + 1] ?? null
      default:                return null
    }
  }

  /** Aplica enriquecimiento a una pista concreta (por id) en su cola. */
  function applyEnrichmentToTrack(track: Track, data: Partial<Track>): void {
    const merged = { ...data, enriched: true }
    switch (player.queueMode) {
      case 'radio':           radio.updateTrack(track.id, merged); break
      case 'recommendations': rec.updateTrack(track.id, merged); break
      case 'playlist': {
        const i = playlistQueue.value.findIndex(t => t.id === track.id)
        if (i >= 0) playlistQueue.value[i] = { ...playlistQueue.value[i], ...merged }
        void persistPlaylistTrack(track.id, merged)
        break
      }
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
    if (player.isShuffle && playlistQueue.value.length > 1) {
      do { idx = Math.floor(Math.random() * playlistQueue.value.length) }
      while (idx === playlistIndex.value)
    } else {
      idx = playlistIndex.value + 1
    }

    if (idx >= playlistQueue.value.length) {
      if (player.repeatMode === 'all') idx = 0
      else { player.state = 'ended'; return }
    }
    playlistIndex.value = idx
    await playCurrent()
  }

  async function prev(): Promise<void> {
    // Si llevamos >3s, reiniciar la pista en lugar de ir a la anterior
    if (player.currentTime > 3) { yt.seekTo(0); return }
    switch (player.queueMode) {
      case 'radio':           if (radio.hasPrev) { radio.prev(); await playCurrent() } return
      case 'recommendations': if (rec.hasPrev)   { rec.prev();   await playCurrent() } return
      case 'playlist':
        if (playlistIndex.value > 0) { playlistIndex.value--; await playCurrent() }
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
    next, prev, togglePlay,
    playlistIndex, playlistQueue
  }
}
