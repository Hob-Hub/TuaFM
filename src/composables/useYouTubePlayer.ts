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

// Estado singleton (vive una sola vez en App.vue)
let player: YTPlayer | null = null
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

  async function init(mountEl: HTMLElement): Promise<void> {
    await loadApi()
    if (player) { ready.value = true; return }

    player = new window.YT!.Player(mountEl, {
      height: '0',
      width: '0',
      playerVars: { autoplay: 0, controls: 0, disablekb: 1, playsinline: 1, origin: window.location.origin },
      events: {
        onReady: () => {
          ready.value = true
          player!.setVolume(playerStore.volume)
          if (playerStore.isMuted) player!.mute()
          startTicker()
        },
        onStateChange: (e: YTPlayerEvent) => handleState(e.data),
        onError: (e: YTPlayerEvent) => {
          // Si hay handler de fallback (probar otro candidato / saltar), delegamos
          // en él; si no, dejamos el estado de error como antes.
          if (onErrorCb) onErrorCb(e.data)
          else playerStore.state = 'error'
        }
      }
    })
  }

  function handleState(state: number): void {
    const S = window.YT!.PlayerState
    switch (state) {
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

  /** Refleja en el SO si está sonando o en pausa (pantalla de bloqueo, etc.). */
  function setPlaybackState(s: MediaSessionPlaybackState): void {
    if ('mediaSession' in navigator) navigator.mediaSession.playbackState = s
  }

  function startTicker(): void {
    if (ticker) return
    ticker = setInterval(() => {
      if (!player) return
      try {
        playerStore.currentTime = player.getCurrentTime() || 0
        const d = player.getDuration() || 0
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

  function loadAndPlay(videoId: string): void {
    if (!player) return
    playerStore.state = 'loading'
    playerStore.currentTime = 0
    anchorPlay()   // arranca el ancla dentro del gesto (evita bloqueo de autoplay)
    player.loadVideoById(videoId)
  }

  function play():  void { anchorPlay(); player?.playVideo() }
  function pause(): void { anchorPause(); player?.pauseVideo() }
  function toggle(): void {
    if (playerStore.isPlaying) pause(); else play()
  }
  function seekTo(seconds: number): void { player?.seekTo(seconds, true) }
  function setVolume(v: number): void {
    playerStore.volume = v
    player?.setVolume(v)
    if (v > 0 && playerStore.isMuted) unmute()
  }
  function mute():   void { playerStore.isMuted = true;  player?.mute() }
  function unmute(): void { playerStore.isMuted = false; player?.unMute() }
  function toggleMute(): void { if (playerStore.isMuted) unmute(); else mute() }

  function onEnded(cb: () => void): void { onEndedCb = cb }
  function onError(cb: (code: number) => void): void { onErrorCb = cb }

  return {
    ready, init, loadAndPlay, play, pause, toggle, seekTo,
    setVolume, mute, unmute, toggleMute, onEnded, onError
  }
}
