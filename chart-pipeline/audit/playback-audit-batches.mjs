#!/usr/bin/env node
/*
  Batch runner for youtube_playback_audit.mjs.

  Runs the playback auditor in small chunks and writes a combined report after
  every chunk, so a long full-catalog audit can be resumed safely.
*/

import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '..', '..')
const AUDIT_SCRIPT = path.join(HERE, 'playback-audit.mjs')
const DEFAULT_CATALOG = path.join(ROOT, 'public', 'catalog', 'tracks.json')

function parseArgs(argv) {
  const args = {
    catalog: DEFAULT_CATALOG,
    scope: '--all',
    chunkSize: 100,
    startOffset: 0,
    maxChunks: 0,
    concurrency: 2,
    sampleMs: 4500,
    timeoutMs: 16000,
    pauseMs: 5000,
    stopFailRate: 0.35,
    reportDir: path.join(HERE, 'out', 'playback-full'),
    combinedReport: path.join(HERE, 'out', 'playback-all-report.json'),
    resume: true,
    quiet: false,
  }

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i]
    const value = () => {
      const next = argv[i + 1]
      if (!next || next.startsWith('--')) throw new Error(`Missing value for ${token}`)
      i += 1
      return next
    }
    switch (token) {
      case '--catalog': args.catalog = path.resolve(value()); break
      case '--all': args.scope = '--all'; break
      case '--chart': args.scope = `--chart=${value()}`; break
      case '--chunk-size': args.chunkSize = Number(value()); break
      case '--start-offset': args.startOffset = Number(value()); break
      case '--max-chunks': args.maxChunks = Number(value()); break
      case '--concurrency': args.concurrency = Number(value()); break
      case '--sample-ms': args.sampleMs = Number(value()); break
      case '--timeout-ms': args.timeoutMs = Number(value()); break
      case '--pause-ms': args.pauseMs = Number(value()); break
      case '--stop-fail-rate': args.stopFailRate = Number(value()); break
      case '--report-dir': args.reportDir = path.resolve(value()); break
      case '--combined-report': args.combinedReport = path.resolve(value()); break
      case '--no-resume': args.resume = false; break
      case '--quiet': args.quiet = true; break
      case '--help':
        printHelp()
        process.exit(0)
      default:
        throw new Error(`Unknown argument: ${token}`)
    }
  }

  if (!Number.isFinite(args.chunkSize) || args.chunkSize < 1) throw new Error('--chunk-size must be >= 1')
  if (!Number.isFinite(args.startOffset) || args.startOffset < 0) throw new Error('--start-offset must be >= 0')
  if (!Number.isFinite(args.maxChunks) || args.maxChunks < 0) throw new Error('--max-chunks must be >= 0')
  if (!Number.isFinite(args.concurrency) || args.concurrency < 1) throw new Error('--concurrency must be >= 1')
  if (!Number.isFinite(args.sampleMs) || args.sampleMs < 1000) throw new Error('--sample-ms must be >= 1000')
  if (!Number.isFinite(args.timeoutMs) || args.timeoutMs < args.sampleMs) throw new Error('--timeout-ms must be >= --sample-ms')
  if (!Number.isFinite(args.pauseMs) || args.pauseMs < 0) throw new Error('--pause-ms must be >= 0')
  if (!Number.isFinite(args.stopFailRate) || args.stopFailRate < 0 || args.stopFailRate > 1) throw new Error('--stop-fail-rate must be between 0 and 1')
  return args
}

function printHelp() {
  console.log(`Usage:
  node chart-pipeline/audit/playback-audit-batches.mjs --all [options]

Options:
  --chunk-size 100
  --start-offset 0
  --max-chunks 0          0 means all remaining chunks
  --concurrency 2
  --sample-ms 4500
  --timeout-ms 16000
  --pause-ms 5000
  --stop-fail-rate 0.35   Stop if one chunk fails above this ratio
  --report-dir audit/out/playback-full
  --combined-report audit/out/playback-all-report.json
  --no-resume             Re-run chunks even if their report exists
`)
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'))
}

function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n', 'utf8')
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function summarize(results) {
  const byStatus = {}
  for (const result of results) byStatus[result.status] = (byStatus[result.status] || 0) + 1
  return {
    checked: results.length,
    ok: results.filter((result) => result.ok).length,
    failed: results.filter((result) => !result.ok).length,
    byStatus,
  }
}

function expectedChunkCount(total, offset, chunkSize) {
  return Math.max(0, Math.min(chunkSize, total - offset))
}

function chunkReportPath(reportDir, offset, limit) {
  return path.join(reportDir, `chunk_${String(offset).padStart(5, '0')}_${String(limit).padStart(3, '0')}.json`)
}

function scopeArgs(scope) {
  if (scope.startsWith('--chart=')) return ['--chart', scope.slice('--chart='.length)]
  return [scope]
}

function runChunk(args, offset, limit, reportPath) {
  const childArgs = [
    AUDIT_SCRIPT,
    ...scopeArgs(args.scope),
    '--offset', String(offset),
    '--limit', String(limit),
    '--concurrency', String(args.concurrency),
    '--sample-ms', String(args.sampleMs),
    '--timeout-ms', String(args.timeoutMs),
    '--report', reportPath,
    '--quiet',
  ]

  const result = spawnSync(process.execPath, childArgs, {
    cwd: ROOT,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  if (result.stdout && !args.quiet) process.stdout.write(result.stdout)
  if (result.stderr) process.stderr.write(result.stderr)
  if (result.status !== 0) throw new Error(`Chunk offset ${offset} failed with exit code ${result.status}`)
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const catalog = readJson(args.catalog)
  const total = (catalog.tracks || []).length
  const startedAt = new Date()
  const allResults = []
  let chunksRun = 0

  fs.mkdirSync(args.reportDir, { recursive: true })

  for (let offset = args.startOffset; offset < total; offset += args.chunkSize) {
    if (args.maxChunks > 0 && chunksRun >= args.maxChunks) break
    const limit = expectedChunkCount(total, offset, args.chunkSize)
    const reportPath = chunkReportPath(args.reportDir, offset, limit)
    const label = `${offset}-${offset + limit - 1}`

    if (args.resume && fs.existsSync(reportPath)) {
      const existing = readJson(reportPath)
      if ((existing.results || []).length >= limit) {
        console.log(`[skip] ${label} already checked`)
      } else {
        console.log(`[run] ${label} incomplete report, rechecking`)
        runChunk(args, offset, limit, reportPath)
      }
    } else {
      console.log(`[run] ${label}`)
      runChunk(args, offset, limit, reportPath)
    }

    const chunk = readJson(reportPath)
    const chunkSummary = summarize(chunk.results || [])
    if (chunkSummary.checked >= 20 && chunkSummary.failed / chunkSummary.checked > args.stopFailRate) {
      throw new Error(`Stopping after chunk ${label}: failure rate ${chunkSummary.failed}/${chunkSummary.checked} exceeds ${args.stopFailRate}`)
    }

    allResults.push(...(chunk.results || []))
    allResults.sort((a, b) => Number(a.index) - Number(b.index))
    const combined = {
      checkedAt: startedAt.toISOString(),
      updatedAt: new Date().toISOString(),
      args,
      totalSelected: total,
      processedChunks: chunksRun + 1,
      processedThroughOffset: offset + limit - 1,
      summary: summarize(allResults),
      results: allResults,
    }
    writeJson(args.combinedReport, combined)
    console.log(`[summary] ${JSON.stringify(combined.summary)}`)
    chunksRun += 1
    if (offset + args.chunkSize < total && args.pauseMs > 0) await sleep(args.pauseMs)
  }

  const finalReport = readJson(args.combinedReport)
  finalReport.finishedAt = new Date().toISOString()
  finalReport.elapsedSeconds = Math.round((Date.now() - startedAt.getTime()) / 100) / 10
  writeJson(args.combinedReport, finalReport)
  console.log(`[done] ${JSON.stringify(finalReport.summary)}`)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
