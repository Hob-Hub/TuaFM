import {
  getSimilarTracks, getSimilarArtists, getArtistTopTracks,
  getTrackTopTags, getTagTopTracks
} from '@/services/lastfm.similarity.service'
import type { RecommendCandidate } from '@/types/queue.types'
import type { FavoriteTrack } from '@/types/playlist.types'
import type { Track } from '@/types/track.types'
import { nanoid } from 'nanoid'
import { makeCacheKey } from '@/db/local.db'

const WEIGHT_A = 0.50
const WEIGHT_B = 0.30
const WEIGHT_C = 0.20
const MAX_SEEDS = 12

function sleep(ms: number): Promise<void> { return new Promise(r => setTimeout(r, ms)) }

async function batchedAllSettled<T>(
  tasks: (() => Promise<T>)[],
  batchSize = 4,
  delayMs   = 200
): Promise<PromiseSettledResult<T>[]> {
  const results: PromiseSettledResult<T>[] = []
  for (let i = 0; i < tasks.length; i += batchSize) {
    const batch = tasks.slice(i, i + batchSize).map(t => t())
    results.push(...await Promise.allSettled(batch))
    if (i + batchSize < tasks.length) await sleep(delayMs)
  }
  return results
}

export async function buildRecommendations(
  favorites:  FavoriteTrack[],
  outputSize  = 25
): Promise<Track[]> {
  const seeds        = favorites.slice(0, MAX_SEEDS)
  const candidateMap = new Map<string, RecommendCandidate>()
  const favKeys      = new Set(favorites.map(f => makeCacheKey(f.artist, f.title)))

  function upsert(artist: string, title: string, dA: number, dB: number, dC: number): void {
    const key = makeCacheKey(artist, title)
    if (favKeys.has(key)) return   // no recomendar lo ya favorito
    const c = candidateMap.get(key)
    if (c) {
      c.scoreA += dA; c.scoreB += dB; c.scoreC += dC
      c.totalScore = c.scoreA * WEIGHT_A + c.scoreB * WEIGHT_B + c.scoreC * WEIGHT_C
    } else {
      candidateMap.set(key, {
        artist, title, scoreA: dA, scoreB: dB, scoreC: dC,
        totalScore: dA * WEIGHT_A + dB * WEIGHT_B + dC * WEIGHT_C
      })
    }
  }

  // Ruta A: track.getSimilar en batches de 4
  const routeAResults = await batchedAllSettled(
    seeds.map(fav => () => getSimilarTracks(fav.artist, fav.title, 15))
  )
  for (const r of routeAResults) {
    if (r.status !== 'fulfilled') continue
    for (const t of r.value.similartracks?.track ?? [])
      upsert(t.artist.name, t.name, parseFloat(t.match) * 100, 0, 0)
  }

  // Ruta B: artistas similares → top tracks
  const uniqueArtists = [...new Set(seeds.map(f => f.artist))].slice(0, 6)
  const routeBResults = await batchedAllSettled(
    uniqueArtists.map(a => () => getSimilarArtists(a, 4))
  )
  const simArtists: string[] = []
  for (const r of routeBResults) {
    if (r.status !== 'fulfilled') continue
    simArtists.push(...(r.value.similarartists?.artist ?? []).map(a => a.name))
  }
  const topTracksResults = await batchedAllSettled(
    [...new Set(simArtists)].slice(0, 10).map(a => () => getArtistTopTracks(a, 4))
  )
  for (const r of topTracksResults) {
    if (r.status !== 'fulfilled') continue
    ;(r.value.toptracks?.track ?? []).forEach((t, i) => upsert(t.artist.name, t.name, 0, 100 / (i + 1), 0))
  }

  // Ruta C: tags dominantes → top tracks del género
  const tagCountMap = new Map<string, number>()
  const tagResults = await batchedAllSettled(
    seeds.map(f => () => getTrackTopTags(f.artist, f.title))
  )
  for (const r of tagResults) {
    if (r.status !== 'fulfilled') continue
    ;(r.value.toptags?.tag ?? []).slice(0, 3).forEach((tag, i) =>
      tagCountMap.set(tag.name, (tagCountMap.get(tag.name) ?? 0) + 1 / (i + 1))
    )
  }
  const topTags = [...tagCountMap.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4).map(([n]) => n)
  const tagTracksResults = await batchedAllSettled(
    topTags.map(tag => () => getTagTopTracks(tag, 10))
  )
  for (const r of tagTracksResults) {
    if (r.status !== 'fulfilled') continue
    ;(r.value.tracks?.track ?? []).forEach((t, i) => upsert(t.artist.name, t.name, 0, 0, 100 / (i + 1)))
  }

  const pool = [...candidateMap.values()]
    .map(c => ({ ...c, totalScore: c.totalScore + Math.random() * 5 }))
    .sort((a, b) => b.totalScore - a.totalScore)
    .slice(0, 60)

  return weightedSampleCandidates(pool, outputSize).map(c => ({
    id: nanoid(), artist: c.artist, title: c.title, enriched: false
  }))
}

function weightedSampleCandidates(pool: RecommendCandidate[], n: number): RecommendCandidate[] {
  const copy = [...pool]
  const result: RecommendCandidate[] = []
  while (result.length < n && copy.length > 0) {
    const total = copy.reduce((s, c) => s + c.totalScore, 0)
    if (total <= 0) break
    let rand = Math.random() * total
    for (let i = 0; i < copy.length; i++) {
      rand -= copy[i].totalScore
      if (rand <= 0) { result.push(copy[i]); copy.splice(i, 1); break }
    }
  }
  return result
}
