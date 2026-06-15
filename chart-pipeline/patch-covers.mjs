// Parche puntual del catálogo: re-resuelve con Deezer las carátulas sembradas
// desde prisaradio (recursosweb.prisaradio.com), que el navegador bloquea por ORB
// (responden sin content-type/CORS válidos → el <img> nunca pinta y cae al
// placeholder de inicial). Deezer es CORS-friendly y sus URLs sí se pintan.
//
// NO regenera los charts: solo reescribe `coverUrl` en public/catalog/tracks.json
// para las pistas afectadas. Reanudable (cachea en .deezer-cache.db); las que
// Deezer no encuentre se dejan como están (seguirán mostrando la inicial).
//
//   node chart-pipeline/patch-covers.mjs           # aplica
//   node chart-pipeline/patch-covers.mjs --dry-run # solo informa, no escribe

import { readFileSync, writeFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { trackCover, stats, closeCache } from './lib/deezer.mjs'

const __dir = dirname(fileURLToPath(import.meta.url))
const FILE = resolve(__dir, '..', 'public', 'catalog', 'tracks.json')
const BLOCKED = 'recursosweb.prisaradio.com'
const dryRun = process.argv.includes('--dry-run')

const data = JSON.parse(readFileSync(FILE, 'utf8'))
const tracks = data.tracks ?? []
const targets = tracks.filter(t => typeof t.coverUrl === 'string' && t.coverUrl.includes(BLOCKED))

console.log(`Pistas con carátula de prisaradio: ${targets.length} / ${tracks.length}`)
if (!targets.length) { closeCache(); process.exit(0) }

let resolved = 0, unresolved = 0
for (let i = 0; i < targets.length; i++) {
  const t = targets[i]
  const cover = await trackCover(t.artist, t.title)
  if (cover) { t.coverUrl = cover; resolved++ }
  else { unresolved++ }
  if ((i + 1) % 100 === 0 || i === targets.length - 1) {
    process.stdout.write(`\r  ${i + 1}/${targets.length} · resueltas ${resolved} · sin Deezer ${unresolved} · API ${stats.apiCalls}   `)
  }
}
process.stdout.write('\n')

if (dryRun) {
  console.log('(dry-run) no se escribe nada.')
} else {
  writeFileSync(FILE, JSON.stringify(data))
  console.log(`Escrito ${FILE} · ${resolved} carátulas reemplazadas, ${unresolved} sin coincidencia en Deezer.`)
}
closeCache()
