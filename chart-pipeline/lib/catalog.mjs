// Construcción del catálogo normalizado (tracks + artistas) a partir de los
// periodos anuales ricos (salida de annualize.mjs) y compactación de los charts
// para que referencien el catálogo por id. Funciones puras (sin I/O ni Last.fm):
// el enriquecimiento Last.fm lo añade build-charts.mjs sobre estos esqueletos.

const primaryName = artistDisplay => String(artistDisplay || '').split(', ')[0].trim()

/**
 * @param charts [{ chartId, periods, seedByKey }]
 *   periods    → periodos ricos de annualizeRows (songs con artist/title/display/yt/cover)
 *   seedByKey  → Map(key → { album, year }) extraído de v_chart (opcional)
 * @returns { tracks, artists, trackIdByKey }
 */
export function buildCatalog(charts) {
  const tracks = []
  const artists = []
  const trackIdByKey  = new Map()
  const artistIdByKey = new Map()

  function ensureArtist(artistKey, displayName) {
    let id = artistIdByKey.get(artistKey)
    if (id === undefined) {
      id = artists.length
      artists.push({ id, key: artistKey, name: displayName || artistKey })
      artistIdByKey.set(artistKey, id)
    }
    return id
  }

  for (const { periods, seedByKey } of charts) {
    for (const period of periods) {
      for (const song of period.songs) {
        const key = `${song.artist}::${song.title}`
        if (trackIdByKey.has(key)) {
          // Track ya visto (otro año u otro chart): completa enlaces si faltaban.
          const t = tracks[trackIdByKey.get(key)]
          if (!t.youtubeVideoId && song.youtubeVideoId) t.youtubeVideoId = song.youtubeVideoId
          if (!t.coverUrl && song.coverUrl)             t.coverUrl       = song.coverUrl
          continue
        }
        const artistId = ensureArtist(song.artist, primaryName(song.artistDisplay))
        const seed = seedByKey?.get(key)
        const id = tracks.length
        tracks.push({
          id, key,
          title:  song.titleDisplay ?? song.title,
          artist: song.artistDisplay ?? song.artist,
          artistId,
          ...(seed?.album ? { album: seed.album } : {}),
          ...(seed?.year  ? { year:  seed.year }  : {}),
          ...(song.youtubeVideoId ? { youtubeVideoId: song.youtubeVideoId } : {}),
          ...(song.coverUrl       ? { coverUrl:       song.coverUrl }       : {})
        })
        trackIdByKey.set(key, id)
      }
    }
  }

  return { tracks, artists, trackIdByKey }
}

/** Periodos compactos: cada canción referencia el track por id. */
export function compactPeriods(periods, trackIdByKey) {
  return periods.map(p => ({
    year: p.year,
    songs: p.songs.map(s => ({
      t: trackIdByKey.get(`${s.artist}::${s.title}`),
      r: s.rank,
      s: s.score,
      p: s.peakPosition,
      w: s.weeksOnChart
    }))
  }))
}

/** Map(key → { album, year }) a partir de filas de v_chart, para sembrar el catálogo. */
export function seedMapFromRows(rows, cfg, normalizeStr, splitArtist) {
  const map = new Map()
  for (const row of rows) {
    const { artist } = splitArtist(String(row[cfg.artistField] || ''), cfg.artistSeparator)
    const title = normalizeStr(String(row[cfg.titleField] || '').trim().replace(/\s+/g, ' '))
    const key = `${artist}::${title}`
    if (map.has(key)) continue
    const album = cfg.albumField ? (row[cfg.albumField] || null) : null
    const year  = cfg.yearField  ? (Number(row[cfg.yearField]) || null) : null
    if (album || year) map.set(key, { album: album || undefined, year: year || undefined })
  }
  return map
}
