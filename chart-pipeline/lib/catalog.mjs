// Construcción del catálogo normalizado (tracks + artistas) a partir de los
// periodos anuales ricos (salida de annualize.mjs) y compactación de los charts.
// Funciones puras (sin I/O ni Last.fm): el enriquecimiento lo añade build-charts.
//
// DEDUP: la misma canción/artista puede venir con grafías distintas entre ES y US
// ("Tik tok"/"Tik Tok", "Ke$ha"/"Kesha", "Jay Z"/"Jay-Z", orden de feat. A,B/B,A).
// Se fusionan por una HUELLA agresiva en una entrada canónica, y se exporta un
// índice de ALIAS (key → id canónico) para que el matching en runtime no cambie.
//
// MULTI-ARTISTA: cada track guarda artistIds[] con TODOS sus artistas, y cada
// colaborador tiene su propia entrada de artista (enriquecida luego).

import { normalizeStr } from './annualize.mjs'

// Clave de runtime: idéntica a makeCacheKey de la app (normalizeStr).
const normKey = s => normalizeStr(String(s))

// Huella agresiva para detectar duplicados (más allá del cacheKey): minúsculas,
// sin diacríticos, &→and, $→s, y fuera todo lo no alfanumérico.
const tight = s => String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/&/g, ' and ').replace(/\$/g, 's').replace(/[^a-z0-9]+/g, '')

export function buildCatalog(charts) {
  const tracks = [], artists = []
  const artistByFp = new Map()       // huella → artista canónico
  const artistAliases = new Map()    // normKey alternativa → id canónico
  const trackByFp = new Map()        // huella → track canónico
  const trackIdByKey = new Map()     // CUALQUIER key de canción → id canónico (para compactar)
  const trackAliases = new Map()     // key no canónica → id canónico (para runtime/overrides)

  function ensureArtist(displayName) {
    const name = String(displayName).trim()
    const fp = tight(name)
    const key = normKey(name)
    const hit = artistByFp.get(fp)
    if (hit) {
      if (key !== hit.key) artistAliases.set(key, hit.id)
      return hit.id
    }
    const a = { id: artists.length, key, name }
    artists.push(a); artistByFp.set(fp, a)
    return a.id
  }

  for (const { periods, seedByKey } of charts) {
    for (const period of periods) {
      for (const song of period.songs) {
        const names = (song.artistNames && song.artistNames.length)
          ? song.artistNames : [song.artistDisplay || song.artist]
        const artistIds = names.map(ensureArtist)
        const songKey = `${song.artist}::${song.title}`
        const fp = artistIds.map((_, i) => tight(names[i])).sort().join('|') + '::' + tight(song.titleDisplay ?? song.title)

        const canon = trackByFp.get(fp)
        if (canon) {
          if (!canon.youtubeVideoId && song.youtubeVideoId) canon.youtubeVideoId = song.youtubeVideoId
          if (!canon.coverUrl && song.coverUrl)             canon.coverUrl       = song.coverUrl
          const seed = seedByKey?.get(songKey)
          if (!canon.album && seed?.album) canon.album = seed.album
          if (!canon.year && seed?.year)   canon.year  = seed.year
          // Año de debut en el Top: el más temprano en que aparece (en cualquier chart).
          if (period.year < canon.chartYear) canon.chartYear = period.year
          for (const id of artistIds) if (!canon.artistIds.includes(id)) canon.artistIds.push(id)
          trackIdByKey.set(songKey, canon.id)
          if (songKey !== canon.key) trackAliases.set(songKey, canon.id)
          continue
        }
        // Misma cacheKey ya canonizada con OTRA huella (p. ej. feat. o título con
        // distinta puntuación que normalizeStr colapsa pero `tight` no). La key ES
        // la identidad de caché del runtime → no puede haber dos entradas con ella
        // (getTrackByKey solo vería una). Fusiona en la existente.
        const sameKeyId = trackIdByKey.get(songKey)
        if (sameKeyId != null) {
          const c = tracks[sameKeyId]
          if (!c.youtubeVideoId && song.youtubeVideoId) c.youtubeVideoId = song.youtubeVideoId
          if (!c.coverUrl && song.coverUrl)             c.coverUrl       = song.coverUrl
          const seed = seedByKey?.get(songKey)
          if (!c.album && seed?.album) c.album = seed.album
          if (!c.year && seed?.year)   c.year  = seed.year
          if (period.year < c.chartYear) c.chartYear = period.year
          for (const id of artistIds) if (!c.artistIds.includes(id)) c.artistIds.push(id)
          trackByFp.set(fp, c)   // futuras con esta huella caen en la canónica
          continue
        }
        const seed = seedByKey?.get(songKey)
        const t = {
          id: tracks.length, key: songKey,
          title:  song.titleDisplay ?? song.title,
          artist: song.artistDisplay ?? song.artist,
          artistId: artistIds[0], artistIds: [...new Set(artistIds)],
          chartYear: period.year,
          ...(seed?.album ? { album: seed.album } : {}),
          ...(seed?.year  ? { year:  seed.year }  : {}),
          ...(song.youtubeVideoId ? { youtubeVideoId: song.youtubeVideoId } : {}),
          ...(song.coverUrl       ? { coverUrl:       song.coverUrl }       : {})
        }
        tracks.push(t); trackByFp.set(fp, t); trackIdByKey.set(songKey, t.id)
      }
    }
  }

  return {
    tracks, artists, trackIdByKey,
    trackAliases:  Object.fromEntries(trackAliases),
    artistAliases: Object.fromEntries(artistAliases)
  }
}

/** Periodos compactos: cada canción referencia el track por id (canónico). */
export function compactPeriods(periods, trackIdByKey) {
  return periods.map(p => ({
    year: p.year,
    songs: p.songs.map(s => ({
      t: trackIdByKey.get(`${s.artist}::${s.title}`),
      r: s.rank, s: s.score, p: s.peakPosition, w: s.weeksOnChart
    }))
  }))
}

/** Map(key → { album, year }) a partir de filas de v_chart, para sembrar el catálogo. */
export function seedMapFromRows(rows, cfg, normalize, splitArtist) {
  const map = new Map()
  for (const row of rows) {
    const { artist } = splitArtist(String(row[cfg.artistField] || ''), cfg.artistSeparator)
    const title = normalize(String(row[cfg.titleField] || '').trim().replace(/\s+/g, ' '))
    const key = `${artist}::${title}`
    if (map.has(key)) continue
    const album = cfg.albumField ? (row[cfg.albumField] || null) : null
    const year  = cfg.yearField  ? (Number(row[cfg.yearField]) || null) : null
    if (album || year) map.set(key, { album: album || undefined, year: year || undefined })
  }
  return map
}

/**
 * Aplica correcciones manuales sobre el catálogo ya generado. Resuelve cada key
 * de override por key directa O por alias (así una corrección sobre una grafía
 * duplicada llega a la entrada canónica). Un campo null BORRA el campo generado.
 * @returns nº de entradas con override aplicado
 */
export function applyOverrides(tracks, artists, overrides, trackAliases = {}, artistAliases = {}) {
  if (!overrides) return 0
  const merge = (entry, ov) => {
    for (const [k, v] of Object.entries(ov)) { if (v === null) delete entry[k]; else entry[k] = v }
  }
  const tByKey = new Map(tracks.map(t => [t.key, t]))
  const tById  = new Map(tracks.map(t => [t.id, t]))
  const aByKey = new Map(artists.map(a => [a.key, a]))
  const aById  = new Map(artists.map(a => [a.id, a]))
  const resolveT = k => tByKey.get(k) || tById.get(trackAliases[k])
  const resolveA = k => aByKey.get(k) || aById.get(artistAliases[k])

  let n = 0
  for (const [k, ov] of Object.entries(overrides.tracks ?? {}))  { const t = resolveT(k); if (t) { merge(t, ov); n++ } }
  for (const [k, ov] of Object.entries(overrides.artists ?? {})) { const a = resolveA(k); if (a) { merge(a, ov); n++ } }
  return n
}
