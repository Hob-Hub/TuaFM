// Parche puntual del catálogo: elimina URLs de imagen que no vengan de fuentes confiables.
//
// NO regenera los charts: solo normaliza `coverUrl` en public/catalog/tracks.json
// e `imageUrl` en public/catalog/artists.json. Si una pista/artista no tiene
// imagen confiable, se deja sin URL para que la UI use su fallback visual.
//
//   node chart-pipeline/patch-covers.mjs           # aplica
//   node chart-pipeline/patch-covers.mjs --dry-run # solo informa, no escribe

import { readFileSync, writeFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dir = dirname(fileURLToPath(import.meta.url))
const TRACKS_FILE = resolve(__dir, '..', 'public', 'catalog', 'tracks.json')
const ARTISTS_FILE = resolve(__dir, '..', 'public', 'catalog', 'artists.json')
const dryRun = process.argv.includes('--dry-run')

function isTrustedArtworkUrl(url) {
  if (!url) return false
  try {
    const parsed = new URL(url)
    const host = parsed.hostname.toLowerCase()
    const imageLike = /\.(?:jpg|jpeg|png|webp)(?:[?#].*)?$/i.test(url)
    return host === 'lastfm.freetls.fastly.net'
      || host === 'lastfm-img2.akamaized.net'
      || host.endsWith('.last.fm')
      || host === 'cdn-images.dzcdn.net'
      || host.endsWith('.dzcdn.net')
      || host === 'media.fimi.it'
      || host === 'www.fimi.it'
      || (host === 'recursosweb.prisaradio.com' && imageLike)
      || (host === 'snepmusique.com' && parsed.pathname.includes('/wp-content/uploads/') && imageLike)
      || (host === 'images.music-story.com' && imageLike)
  } catch {
    return false
  }
}

function stripUntrustedArtwork(rows, field) {
  let removed = 0
  for (const row of rows) {
    if (row[field] && !isTrustedArtworkUrl(row[field])) {
      delete row[field]
      removed++
    }
  }
  return removed
}

const tracksData = JSON.parse(readFileSync(TRACKS_FILE, 'utf8'))
const artistsData = JSON.parse(readFileSync(ARTISTS_FILE, 'utf8'))

const removedCovers = stripUntrustedArtwork(tracksData.tracks ?? [], 'coverUrl')
const removedArtistImages = stripUntrustedArtwork(artistsData.artists ?? [], 'imageUrl')

console.log(`Carátulas fuera de fuentes confiables eliminadas: ${removedCovers}`)
console.log(`Fotos de artista fuera de fuentes confiables eliminadas: ${removedArtistImages}`)

if (dryRun) {
  console.log('(dry-run) no se escribe nada.')
} else {
  writeFileSync(TRACKS_FILE, JSON.stringify(tracksData))
  writeFileSync(ARTISTS_FILE, JSON.stringify(artistsData))
  console.log(`Escrito ${TRACKS_FILE}`)
  console.log(`Escrito ${ARTISTS_FILE}`)
}
