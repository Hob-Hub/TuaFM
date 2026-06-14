/** parseInt base-10 tolerante: cadena vacía, no numérica o null/undefined → undefined. */
export function toInt(value: string | null | undefined): number | undefined {
  if (value == null) return undefined
  const n = parseInt(value, 10)
  return Number.isNaN(n) ? undefined : n
}
