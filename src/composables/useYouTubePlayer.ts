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
      case S.PLAYING:   playerStore.state = 'playing'; break
      case S.PAUSED:    playerStore.state = 'paused'; break
      case S.BUFFERING: playerStore.state = 'loading'; break
      case S.ENDED:
        playerStore.state = 'ended'
        onEndedCb?.()
        break
    }
  }

  function startTicker(): void {
    if (ticker) return
    ticker = setInterval(() => {
      if (!player) return
      try {
        playerStore.currentTime = player.getCurrentTime() || 0
        const d = player.getDuration() || 0
        if (d > 0) playerStore.duration = d
      } catch { /* player no listo */ }
    }, 500)
  }

  function loadAndPlay(videoId: string): void {
    if (!player) return
    playerStore.state = 'loading'
    playerStore.currentTime = 0
    player.loadVideoById(videoId)
  }

  function play():  void { player?.playVideo() }
  function pause(): void { player?.pauseVideo() }
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
  function toggleMute(): void { playerStore.isMuted ? unmute() : mute() }

  function onEnded(cb: () => void): void { onEndedCb = cb }
  function onError(cb: (code: number) => void): void { onErrorCb = cb }

  return {
    ready, init, loadAndPlay, play, pause, toggle, seekTo,
    setVolume, mute, unmute, toggleMute, onEnded, onError
  }
}
