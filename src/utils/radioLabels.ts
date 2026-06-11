/**
 * Etiqueta humana para el nivel de "nostalgia" (el λ interno): cuánto se ciñe la
 * radio al año de referencia frente a mezclar épocas cercanas. Evita exponer el
 * lambda crudo en la UI. λ alto → solo ese año; λ bajo → mezcla amplia.
 */
export function nostalgiaLabel(lambda: number): string {
  if (lambda >= 0.8)  return 'Solo ese año'
  if (lambda >= 0.55) return 'Sobre todo ese año'
  if (lambda >= 0.35) return 'Mezcla cercana'
  if (lambda >= 0.2)  return 'Mezcla amplia'
  return 'Mezcla de épocas'
}
