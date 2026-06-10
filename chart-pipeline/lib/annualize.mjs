// Consolidación de charts → períodos ANUALES. La consume build-charts.mjs para
// exportar el bundle estático (JSON en ../public/).
//
// La SQLite de origen sigue siendo la fuente rica de la verdad (semanal para
// España, anual para Billboard). Aquí se "aplana" a un único Top por año natural,
// puntuando cada canción por sus posiciones a lo largo del año. Así:
//   · se conserva la información valiosa de las semanas (tiempo en cabeza),
//   · el bundle se vuelve pequeño (1 período/año en vez de 52),
//   · España y Billboard quedan con la MISMA forma (ChartPeriod anual).
//
// Sin dependencias externas: funciones puras reutilizables y testeables.

// ── Helpers de normalización (idénticos a src/utils/normalize.ts) ────────────
// Mantienen los cacheKey alineados entre datos de charts y enriquecimiento Last.fm.
export function normalizeStr(s) {
  return String(s).toLowerCase().trim()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, ' ')
}

export function extractVideoId(url) {
  if (!url) return null
  const m = String(url).match(/(?:v=|youtu\.be\/|embed\/)([A-Za-z0-9_-]{11})/)
  return m ? m[1] : null
}

export function splitArtist(raw, separator) {
  const sep   = separator || ';'
  const parts = String(raw).split(sep).map(p => p.trim()).filter(Boolean)
  const first = parts[0] ?? ''
  return { artist: normalizeStr(first), artistDisplay: parts.join(', '), parts }
}

// ── Puntuación de posición ───────────────────────────────────────────────────
// 1/√p: el Nº1 vale 1.0; Nº2 ≈ 0.71; Nº10 ≈ 0.32; Nº40 ≈ 0.16. Premia las
// posiciones de cabeza de forma suave, y al sumarse sobre las semanas del año
// equilibra PICO y PERMANENCIA (como un year-end real).
//
// ÚNICO punto para afinar ese equilibrio (ver README → "Algoritmo de
// consolidación"): para dar MÁS peso al pico, hacerlo más pronunciado (1/p, 1/p²);
// para más permanencia, más plano. Tras cambiarlo hay que regenerar el bundle.
export function positionScore(p) {
  return 1 / Math.sqrt(Math.max(1, Number(p)))
}

// ── Año natural de una fecha ISO ('YYYY-MM-DD' o ISO completa) ────────────────
export function yearOf(isoDateStr) {
  return Number(String(isoDateStr).slice(0, 4))
}

const yearInRange = (y, fromYear, toYear) => y >= fromYear && y <= toYear

// Construye la lista de canciones rankeadas de un año a partir de un acumulador
// Map<trackKey, agg> y la envuelve en un ChartPeriod anual.
function buildPeriod(chartId, year, aggMap) {
  const songs = [...aggMap.values()]
    .sort((a, b) => b.score - a.score)
    .map((a, i) => ({
      rank:           i + 1,
      position:       i + 1,                 // alias para UI genérica
      score:          Number(a.score.toFixed(4)),
      peakPosition:   a.peakPosition,
      weeksOnChart:   a.weeksOnChart,
      artist:         a.artist,
      artistDisplay:  a.artistDisplay,
      artistNames:    a.artistNames,        // nombres de TODOS los artistas (display)
      title:          a.title,
      titleDisplay:   a.titleDisplay,
      ...(a.youtubeVideoId ? { youtubeVideoId: a.youtubeVideoId } : {}),
      ...(a.coverUrl       ? { coverUrl:       a.coverUrl }       : {})
    }))
  return { chartId, year, songs }
}

// ── Consolidación de una fuente SEMANAL (España) → Top anual ─────────────────
// rows: filas de v_chart (una por entrada semanal). Agrupa por año natural y
// acumula yearScore = Σ positionScore(posición). Los metadatos de display y los
// enlaces (cover/youtube) se toman de la semana de MEJOR posición de la canción.
export function annualizeWeekly(rows, cfg, fromYear, toYear) {
  const byYear = new Map()   // year → Map<key, agg>

  for (const row of rows) {
    const year = yearOf(row[cfg.dateField])
    if (!yearInRange(year, fromYear, toYear)) continue

    const position = Number(row[cfg.posField])
    if (!Number.isFinite(position) || position < 1) continue

    const rawArtist = String(row[cfg.artistField] || '')
    const { artist, artistDisplay, parts } = splitArtist(rawArtist, cfg.artistSeparator)
    const titleDisplay = String(row[cfg.titleField] || '').trim().replace(/\s+/g, ' ')
    const title        = normalizeStr(titleDisplay)
    const key          = `${artist}::${title}`

    if (!byYear.has(year)) byYear.set(year, new Map())
    const aggMap = byYear.get(year)

    const ytId  = cfg.ytUrlField ? extractVideoId(row[cfg.ytUrlField]) : null
    const cover = cfg.coverField ? (row[cfg.coverField] || null) : null

    const existing = aggMap.get(key)
    if (existing) {
      existing.score       += positionScore(position)
      existing.weeksOnChart += 1
      if (position < existing.peakPosition) {
        // La mejor semana define display/enlaces (mejor portada/vídeo disponible).
        existing.peakPosition  = position
        existing.artistDisplay = artistDisplay
        existing.artistNames   = parts
        existing.titleDisplay  = titleDisplay
        if (ytId)  existing.youtubeVideoId = ytId
        if (cover) existing.coverUrl       = cover
      } else {
        existing.youtubeVideoId = existing.youtubeVideoId || ytId || undefined
        existing.coverUrl       = existing.coverUrl       || cover || undefined
      }
    } else {
      aggMap.set(key, {
        artist, artistDisplay, artistNames: parts, title, titleDisplay,
        score: positionScore(position),
        peakPosition: position,
        weeksOnChart: 1,
        youtubeVideoId: ytId || undefined,
        coverUrl:       cover || undefined
      })
    }
  }

  return [...byYear.keys()].sort((a, b) => a - b)
    .map(year => buildPeriod(cfg.chartId, year, byYear.get(year)))
}

// ── Consolidación de una fuente ya ANUAL (Billboard Year-End) → Top anual ────
// Cada fila ya es una entrada anual con su rank. score = positionScore(rank)
// para quedar en la misma escala que España (Nº1 ≈ 1.0).
export function annualizeAnnual(rows, cfg, fromYear, toYear) {
  const byYear = new Map()

  for (const row of rows) {
    const year = yearOf(row[cfg.dateField])
    if (!yearInRange(year, fromYear, toYear)) continue

    const rank = Number(row[cfg.posField])
    if (!Number.isFinite(rank) || rank < 1) continue

    const rawArtist = String(row[cfg.artistField] || '')
    const { artist, artistDisplay, parts } = splitArtist(rawArtist, cfg.artistSeparator)
    const titleDisplay = String(row[cfg.titleField] || '').trim().replace(/\s+/g, ' ')
    const title        = normalizeStr(titleDisplay)
    const key          = `${artist}::${title}`

    if (!byYear.has(year)) byYear.set(year, new Map())
    const aggMap = byYear.get(year)

    // Una canción por año-rank; si se repitiera, nos quedamos con el mejor rank.
    const existing = aggMap.get(key)
    if (existing) {
      existing.score = Math.max(existing.score, positionScore(rank))
      existing.peakPosition = Math.min(existing.peakPosition, rank)
    } else {
      aggMap.set(key, {
        artist, artistDisplay, artistNames: parts, title, titleDisplay,
        score: positionScore(rank),
        peakPosition: rank,
        weeksOnChart: 1,
        youtubeVideoId: cfg.ytUrlField ? extractVideoId(row[cfg.ytUrlField]) || undefined : undefined,
        coverUrl:       cfg.coverField ? (row[cfg.coverField] || undefined) : undefined
      })
    }
  }

  return [...byYear.keys()].sort((a, b) => a - b)
    .map(year => buildPeriod(cfg.chartId, year, byYear.get(year)))
}

// ── Dispatcher por config.consolidate ────────────────────────────────────────
export function annualizeRows(rows, config, fromYear, toYear) {
  const cfg  = { chartId: config.chartId, ...config.source }
  const mode = config.source.consolidate
    || (config.periodicities?.[0] === 'annual' ? 'annual' : 'annual-from-weekly')

  if (mode === 'annual')              return annualizeAnnual(rows, cfg, fromYear, toYear)
  if (mode === 'annual-from-weekly')  return annualizeWeekly(rows, cfg, fromYear, toYear)
  throw new Error(`consolidate no soportado: ${mode}`)
}
