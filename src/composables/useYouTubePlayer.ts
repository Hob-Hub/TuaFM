import { ref } from 'vue'
import { usePlayerStore } from '@/stores/player.store'

// ── Tipos mínimos de la IFrame Player API ────────────────────────────────────
interface YTPlayer {
  loadVideoById(id: string): void
  cueVideoById(id: string): void
  playVideo(): void
  pauseVideo(): void
  stopVideo(): void
  seekTo(seconds: number, allowSeekAhead: boolean): void
  setVolume(v: number): void
  getVolume(): number
  mute(): void
  unMute(): void
  getCurrentTime(): number
  getDuration(): number
  getPlayerState(): number
  destroy(): void
}
interface YTPlayerEvent { target: YTPlayer; data: number }
type YTStateConst = { ENDED: number; PLAYING: number; PAUSED: number; BUFFERING: number; CUED: number; UNSTARTED: number }

declare global {
  interface Window {
    YT?: {
      Player: new (el: HTMLElement | string, opts: unknown) => YTPlayer
      PlayerState: YTStateConst
    }
    onYouTubeIframeAPIReady?: () => void
  }
}

// ── Reproducción sin cortes (gapless) con dos players ────────────────────────
// Mientras `active` suena, `standby` pre-bufferiza la SIGUIENTE pista con
// cueVideoById (sin sonar). Al pasar de canción, si la pista pedida es la que ya
// estaba cargada en standby, se intercambian los roles y se reproduce al instante
// (sin el silencio de bufferizar). Si no coincide (prev, salto, aleatorio), se
// carga normal en el activo. Toda esta mecánica queda encapsulada aquí.
let active:  YTPlayer | null = null
let standby: YTPlayer | null = null
let standbyVideoId: string | null = null   // qué vídeo tiene cargado el standby
let readyCount = 0

let apiPromise: Promise<void> | null = null
let ticker: ReturnType<typeof setInterval> | null = null
let onEndedCb: (() => void) | null = null
let onErrorCb: ((code: number) => void) | null = null

// ── Ancla de sesión multimedia ───────────────────────────────────────────────
// El vídeo se reproduce dentro de un <iframe> cross-origin de YouTube, y el SO
// tiende a asociar los controles multimedia (teclas, pantalla de bloqueo) a ESE
// iframe, ignorando los handlers de anterior/siguiente que registramos en la
// página padre. Reproducimos un audio *silencioso* en la página padre, en sync
// con el estado real, para que la sesión multimedia del SO sea la nuestra y los
// botones de anterior/siguiente lleguen a nuestros handlers.
let anchor: HTMLAudioElement | null = null

// Tono de baja frecuencia y amplitud ínfima (~-62 dB): técnicamente "audio"
// para que el navegador dé la sesión multimedia a nuestra página, pero inaudible
// — y, además, solo suena cuando suena la música, quedando siempre enmascarado.
function createAnchorAudio(): HTMLAudioElement {
  const sampleRate = 8000
  const numSamples = sampleRate // 1 s, en bucle
  const dataSize = numSamples * 2
  const buffer = new ArrayBuffer(44 + dataSize)
  const view = new DataView(buffer)
  let off = 0
  const wStr = (s: string): void => { for (let i = 0; i < s.length; i++) view.setUint8(off++, s.charCodeAt(i)) }
  const w32 = (v: number): void => { view.setUint32(off, v, true); off += 4 }
  const w16 = (v: number): void => { view.setUint16(off, v, true); off += 2 }
  wStr('RIFF'); w32(36 + dataSize); wStr('WAVE')
  wStr('fmt '); w32(16); w16(1); w16(1); w32(sampleRate); w32(sampleRate * 2); w16(2); w16(16)
  wStr('data'); w32(dataSize)
  const amp = 24, freq = 50 // 50 Hz, 24/32767 ≈ -62 dB
  for (let i = 0; i < numSamples; i++) {
    view.setInt16(44 + i * 2, Math.round(amp * Math.sin((2 * Math.PI * freq * i) / sampleRate)), true)
  }
  const audio = new Audio(URL.createObjectURL(new Blob([buffer], { type: 'audio/wav' })))
  audio.loop = true
  audio.setAttribute('aria-hidden', 'true')
  audio.style.display = 'none'
  document.body.appendChild(audio)
  return audio
}

function anchorPlay(): void {
  try {
    if (!anchor) anchor = createAnchorAudio()
    void anchor.play().catch(() => { /* sin gesto de usuario aún */ })
  } catch { /* Audio no disponible */ }
}
function anchorPause(): void { try { anchor?.pause() } catch { /* noop */ } }

// ── Reanudación al volver a primer plano ─────────────────────────────────────
// Los navegadores móviles pausan el <iframe> de YouTube al apagar la pantalla o
// mandar la pestaña a segundo plano (YouTube no permite background playback en
// móvil). Esa pausa no se puede evitar, pero sí *reanudar* en cuanto el usuario
// vuelve: si la intención era seguir sonando y el reproductor quedó pausado (no
// fue el usuario), se reanuda solo — quita el molesto "se ha parado".
let intendedPlaying = false
let lifecycleBound  = false

function resumeIfIntended(): void {
  if (!active || !intendedPlaying || !window.YT) return
  try {
    const st = active.getPlayerState()
    const S  = window.YT.PlayerState
    if (st === S.PAUSED || st === S.CUED || st === S.UNSTARTED) {
      anchorPlay()
      active.playVideo()
    }
  } catch { /* player no listo */ }
}

function bindLifecycle(): void {
  if (lifecycleBound) return
  lifecycleBound = true
  // Reintenta un par de veces: al volver, el iframe tarda un instante en aceptar play().
  const onForeground = (): void => {
    window.setTimeout(resumeIfIntended, 250)
    window.setTimeout(resumeIfIntended, 900)
  }
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') onForeground()
  })
  window.addEventListener('focus', onForeground)
  window.addEventListener('pageshow', onForeground)
}

function loadApi(): Promise<void> {
  if (apiPromise) return apiPromise
  apiPromise = new Promise<void>(resolve => {
    if (window.YT?.Player) { resolve(); return }
    const prev = window.onYouTubeIframeAPIReady
    window.onYouTubeIframeAPIReady = () => { prev?.(); resolve() }
    if (!document.querySelector('script[src*="youtube.com/iframe_api"]')) {
      const tag = document.createElement('script')
      tag.src = 'https://www.youtube.com/iframe_api'
      document.head.appendChild(tag)
    }
  })
  return apiPromise
}

export function useYouTubePlayer() {
  const playerStore = usePlayerStore()
  const ready = ref(false)

  /** Crea los dos players (activo + standby) montados en dos divs distintos. */
  async function init(mountA: HTMLElement, mountB: HTMLElement): Promise<void> {
    await loadApi()
    bindLifecycle()
    if (active && standby) { ready.value = true; return }

    const make = (el: HTMLElement): YTPlayer => new window.YT!.Player(el, {
      height: '200',
      width: '200',
      playerVars: { autoplay: 0, controls: 0, disablekb: 1, playsinline: 1, origin: window.location.origin },
      events: {
        onReady: (e: YTPlayerEvent) => {
          e.target.setVolume(playerStore.volume)
          if (playerStore.isMuted) e.target.mute()
          readyCount++
          if (readyCount >= 2) { ready.value = true; startTicker() }
        },
        onStateChange: (e: YTPlayerEvent) => handleState(e),
        onError: (e: YTPlayerEvent) => handleError(e)
      }
    })

    active  = make(mountA)
    standby = make(mountB)
  }

  function handleState(e: YTPlayerEvent): void {
    if (e.target !== active) return   // ignora eventos del player en standby (pre-buffer)
    const S = window.YT!.PlayerState
    switch (e.data) {
      case S.PLAYING:   playerStore.state = 'playing'; setPlaybackState('playing'); anchorPlay();  break
      case S.PAUSED:    playerStore.state = 'paused';  setPlaybackState('paused');  anchorPause(); break
      case S.BUFFERING: playerStore.state = 'loading'; setPlaybackState('playing'); anchorPlay();  break
      case S.ENDED:
        playerStore.state = 'ended'
        setPlaybackState('none')
        anchorPause()
        onEndedCb?.()
        break
    }
  }

  function handleError(e: YTPlayerEvent): void {
    // Si falla el vídeo pre-bufferizado en standby, invalida el preload (no
    // saltaremos a un vídeo roto; se cargará normal y entrará el fallback).
    if (e.target === standby) { standbyVideoId = null; return }
    if (onErrorCb) onErrorCb(e.data)
    else playerStore.state = 'error'
  }

  /** Refleja en el SO si está sonando o en pausa (pantalla de bloqueo, etc.). */
  function setPlaybackState(s: MediaSessionPlaybackState): void {
    if ('mediaSession' in navigator) navigator.mediaSession.playbackState = s
  }

  function startTicker(): void {
    if (ticker) return
    ticker = setInterval(() => {
      if (!active) return
      try {
        playerStore.currentTime = active.getCurrentTime() || 0
        const d = active.getDuration() || 0
        if (d > 0) {
          playerStore.duration = d
          // Posición para la barra de progreso del SO.
          if ('mediaSession' in navigator && 'setPositionState' in navigator.mediaSession) {
            try {
              navigator.mediaSession.setPositionState({
                duration: d,
                position: Math.min(playerStore.currentTime, d),
                playbackRate: 1
              })
            } catch { /* valores transitorios fuera de rango */ }
          }
        }
      } catch { /* player no listo */ }
    }, 500)
  }

  /**
   * Carga y reproduce un vídeo. Si es el que el standby ya tenía pre-bufferizado,
   * intercambia roles y arranca al instante (gapless). Si no, lo carga en el
   * activo (con el buffering normal).
   */
  function loadAndPlay(videoId: string): void {
    if (!active) return
    intendedPlaying = true
    playerStore.state = 'loading'
    playerStore.currentTime = 0
    anchorPlay()

    if (standby && standbyVideoId === videoId) {
      // ── Swap gapless ──────────────────────────────────────────────────────
      const old = active
      active  = standby
      standby = old
      standbyVideoId = null
      try { old.stopVideo() } catch { /* noop */ }        // corta la pista anterior primero
      try {
        active.setVolume(playerStore.volume)
        if (playerStore.isMuted) active.mute(); else active.unMute()
      } catch { /* noop */ }
      active.playVideo()                                   // ya cueado → arranca casi al instante
    } else {
      standbyVideoId = null                                // preload obsoleto
      active.loadVideoById(videoId)
    }
  }

  /** Pre-bufferiza la siguiente pista en el player en standby (sin sonar). */
  function preload(videoId: string): void {
    if (!standby || !videoId || standbyVideoId === videoId) return
    standbyVideoId = videoId
    try { standby.cueVideoById(videoId) } catch { standbyVideoId = null }
  }

  function play():  void { intendedPlaying = true;  anchorPlay();  active?.playVideo() }
  function pause(): void { intendedPlaying = false; anchorPause(); active?.pauseVideo() }
  function toggle(): void {
    if (playerStore.isPlaying) pause(); else play()
  }
  function seekTo(seconds: number): void { active?.seekTo(seconds, true) }
  function setVolume(v: number): void {
    playerStore.volume = v
    active?.setVolume(v)
    standby?.setVolume(v)
    if (v > 0 && playerStore.isMuted) unmute()
  }
  function mute():   void { playerStore.isMuted = true;  active?.mute();   standby?.mute() }
  function unmute(): void { playerStore.isMuted = false; active?.unMute(); standby?.unMute() }
  function toggleMute(): void { if (playerStore.isMuted) unmute(); else mute() }

  function onEnded(cb: () => void): void { onEndedCb = cb }
  function onError(cb: (code: number) => void): void { onErrorCb = cb }

  return {
    ready, init, loadAndPlay, preload, play, pause, toggle, seekTo,
    setVolume, mute, unmute, toggleMute, onEnded, onError
  }
}
