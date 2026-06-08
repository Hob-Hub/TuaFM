/**
 * Desplaza el contenedor para que el hijo en `index` quede a la vista.
 * Pensado para listas de cola: cada hijo directo del contenedor es una fila.
 */
export function scrollActiveIntoView(container: HTMLElement | null, index: number): void {
  if (!container || index < 0) return
  const el = container.children[index] as HTMLElement | undefined
  el?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
}
