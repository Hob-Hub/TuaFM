/**
 * Segundo de inicio para reproducir un trozo de `clipSeconds` centrado en una
 * pista de `duration` segundos (modo clips). Se queda dentro de [0, duration-clip]
 * para no pedir un seek fuera de rango cuando el clip no cabe entero.
 */
export function clipCentreStart(duration: number, clipSeconds: number): number {
  return Math.min(
    Math.max(duration / 2 - clipSeconds / 2, 0),
    Math.max(0, duration - clipSeconds),
  )
}
