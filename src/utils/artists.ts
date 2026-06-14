// Separa una cadena de artistas ("David Guetta, Akon", "Tiësto & Dyro",
// "Jay-Z feat. Alicia Keys") en artistas individuales navegables. Pura: la usa
// TrackItem para pintar un enlace por colaborador. No toca el cacheKey (que sigue
// usando el artista principal normalizado).
// Puntuación (,&·/) separa con espacios opcionales; las abreviaturas de
// colaboración (feat./ft./x/…) exigen espacios a ambos lados para no partir
// nombres que las contengan ("Maxwell", "Foxes").
const SEPARATORS = /\s*(?:,|&|·|\/)\s*|\s+(?:feat\.?|ft\.?|featuring|vs\.?|with|x)\s+/gi

export function splitArtists(display: string): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const part of display.split(SEPARATORS)) {
    const name = part.trim()
    if (!name) continue
    const key = name.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(name)
  }
  // Si la separación deja la cadena vacía (raro), devolvemos el original entero.
  return out.length ? out : [display.trim()].filter(Boolean)
}
