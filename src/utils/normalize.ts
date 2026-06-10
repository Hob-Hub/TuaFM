// Normalización Unicode pura (sin dependencias). Debe ser idéntica a la del
// chart-pipeline (lib/catalog.mjs) para que los cacheKey coincidan entre los
// datos de charts y el enriquecimiento Last.fm.

// Rango de marcas diacríticas combinantes (U+0300–U+036F). Construido con
// escapes ASCII para mantener este archivo fuente libre de caracteres especiales.
const DIACRITICS = new RegExp('[\\u0300-\\u036f]', 'g')
const MULTISPACE = /\s+/g

export function normalizeStr(s: string): string {
  return s.toLowerCase().trim()
    .normalize('NFD')
    .replace(DIACRITICS, '')   // Beyonce con acento -> beyonce
    .replace(MULTISPACE, ' ')  // colapsar espacios multiples
}

export function makeCacheKey(artist: string, title: string): string {
  return `${normalizeStr(artist)}::${normalizeStr(title)}`
}
