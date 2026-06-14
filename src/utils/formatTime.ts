/** "m:ss" a partir de segundos. No finito o negativo → "0:00". */
export function formatSeconds(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return '0:00'
  const m = Math.floor(sec / 60)
  const s = Math.floor(sec % 60)
  return `${m}:${String(s).padStart(2, '0')}`
}

/** "m:ss" a partir de milisegundos. 0/undefined → "" (sin duración conocida). */
export function formatDurationMs(ms?: number): string {
  if (!ms) return ''
  return formatSeconds(Math.round(ms / 1000))
}
