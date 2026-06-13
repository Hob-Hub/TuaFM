#!/usr/bin/env node
/*
  Runtime YouTube playback auditor.

  This is intentionally separate from the app. It reads the static catalog/chart
  JSON files, opens a real Chromium page with the YouTube IFrame API, and reports
  videos that do not start, throw player errors, or do not advance time.

  It cannot prove that audio is audible to a human because YouTube runs in a
  cross-origin iframe, but it catches the common runtime failures that oEmbed
  cannot detect.
*/

import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '..', '..')
const DEFAULT_CATALOG = path.join(ROOT, 'public', 'catalog', 'tracks.json')
const DEFAULT_CHARTS_DIR = path.join(ROOT, 'public', 'charts')
const DEFAULT_REPORT = path.join(HERE, 'out', 'playback-audit-report.json')

const YT_ERROR = {
  2: 'invalid-parameter',
  5: 'html5-player-error',
  100: 'video-not-found-or-private',
  101: 'embedding-not-allowed',
  150: 'embedding-not-allowed',
}

function parseArgs(argv) {
  const args = {
    catalog: DEFAULT_CATALOG,
    chartsDir: DEFAULT_CHARTS_DIR,
    chart: 'es',
    all: false,
    ids: '',
    videoIds: '',
    artist: '',
    title: '',
    limit: 25,
    offset: 0,
    concurrency: 2,
    sampleMs: 8000,
    timeoutMs: 20000,
    minProgress: 1,
    minDuration: 45,
    playerSize: 200,
    listenHost: 'localhost',
    youtubeHost: 'https://www.youtube.com',
    report: DEFAULT_REPORT,
    headful: false,
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
      case '--charts-dir': args.chartsDir = path.resolve(value()); break
      case '--chart': args.chart = value(); args.all = false; break
      case '--all': args.all = true; break
      case '--ids': args.ids = value(); break
      case '--video-ids': args.videoIds = value(); break
      case '--artist': args.artist = value().toLowerCase(); break
      case '--title': args.title = value().toLowerCase(); break
      case '--limit': args.limit = Number(value()); break
      case '--offset': args.offset = Number(value()); break
      case '--concurrency': args.concurrency = Number(value()); break
      case '--sample-ms': args.sampleMs = Number(value()); break
      case '--timeout-ms': args.timeoutMs = Number(value()); break
      case '--min-progress': args.minProgress = Number(value()); break
      case '--min-duration': args.minDuration = Number(value()); break
      case '--player-size': args.playerSize = Number(value()); break
      case '--listen-host': args.listenHost = value(); break
      case '--youtube-host': args.youtubeHost = value(); break
      case '--report': args.report = path.resolve(value()); break
      case '--headful': args.headful = true; break
      case '--quiet': args.quiet = true; break
      case '--help':
        printHelp()
        process.exit(0)
      default:
        throw new Error(`Unknown argument: ${token}`)
    }
  }

  if (!Number.isFinite(args.limit)) throw new Error('--limit must be a number')
  if (!Number.isFinite(args.offset) || args.offset < 0) throw new Error('--offset must be >= 0')
  if (!Number.isFinite(args.concurrency) || args.concurrency < 1) throw new Error('--concurrency must be >= 1')
  if (!Number.isFinite(args.sampleMs) || args.sampleMs < 1000) throw new Error('--sample-ms must be >= 1000')
  if (!Number.isFinite(args.timeoutMs) || args.timeoutMs < args.sampleMs) throw new Error('--timeout-ms must be >= --sample-ms')
  if (!Number.isFinite(args.playerSize) || args.playerSize < 0) throw new Error('--player-size must be >= 0')
  if (!['localhost', '127.0.0.1'].includes(args.listenHost)) throw new Error('--listen-host must be localhost or 127.0.0.1')
  if (!['https://www.youtube.com', 'https://www.youtube-nocookie.com'].includes(args.youtubeHost)) {
    throw new Error('--youtube-host must be https://www.youtube.com or https://www.youtube-nocookie.com')
  }
  return args
}

function printHelp() {
  console.log(`Usage:
  node chart-pipeline/audit/playback-audit.mjs [options]

Scopes:
  --chart es              Audit tracks referenced by public/charts/es.json (default)
  --all                   Audit all catalog tracks
  --ids 963,469           Audit specific catalog track ids
  --video-ids abc,def     Audit raw YouTube IDs without catalog lookup
  --artist Macaco         Filter selected scope by artist substring
  --title Moving          Filter selected scope by title substring

Runtime:
  --limit 25              Max tracks to probe. Use --limit 0 for no limit
  --offset 0              Skip N selected tracks
  --concurrency 2         Parallel Chromium pages
  --sample-ms 8000        Time to wait while each video plays
  --timeout-ms 20000      Hard timeout per video
  --player-size 200       IFrame size. Use 0 to reproduce old zero-size mode
  --listen-host localhost Origin exposed to YouTube: localhost or 127.0.0.1
  --youtube-host https://www.youtube.com
                           Player host. Use https://www.youtube-nocookie.com to test no-cookie embeds
  --headful               Show browser window

Output:
  --report audit/out/playback-audit-report.json
`)
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'))
}

function unique(values) {
  return [...new Set(values)]
}

function selectTracks(args) {
  const catalog = readJson(args.catalog)
  const tracks = catalog.tracks || []
  let indexes

  if (args.videoIds) {
    return args.videoIds
      .split(',')
      .map((part, index) => {
        const videoId = part.trim()
        return {
          index: -1 - index,
          id: `video:${videoId}`,
          key: `video::${videoId}`,
          artist: 'Raw YouTube ID',
          title: videoId,
          youtubeVideoId: videoId,
        }
      })
      .filter((track) => track.youtubeVideoId)
  }

  if (args.ids) {
    const ids = new Set(args.ids.split(',').map((part) => Number(part.trim())).filter(Number.isFinite))
    indexes = tracks.map((track, index) => ids.has(Number(track.id)) ? index : -1).filter((index) => index >= 0)
  } else if (args.all) {
    indexes = tracks.map((_, index) => index)
  } else {
    const chartPath = path.join(args.chartsDir, `${args.chart}.json`)
    const chart = readJson(chartPath)
    indexes = unique((chart.periods || []).flatMap((period) => (period.songs || []).map((song) => Number(song.t))))
      .filter((index) => Number.isInteger(index) && tracks[index])
      .sort((a, b) => a - b)
  }

  let selected = indexes.map((index) => ({ index, ...tracks[index] }))
  if (args.artist) selected = selected.filter((track) => String(track.artist || '').toLowerCase().includes(args.artist))
  if (args.title) selected = selected.filter((track) => String(track.title || '').toLowerCase().includes(args.title))
  if (args.offset) selected = selected.slice(args.offset)
  if (args.limit > 0) selected = selected.slice(0, args.limit)
  return selected
}

function buildProbeHtml(args) {
  const playerSize = args.playerSize
  const size = String(playerSize)
  const youtubeHost = args.youtubeHost
  return `<!doctype html>
<html>
<head><meta charset="utf-8"><title>YouTube Playback Audit</title></head>
<body>
<div id="player"></div>
<script>
  const size = ${JSON.stringify(size)};
  const youtubeHost = ${JSON.stringify(youtubeHost)};
  let player = null;
  let active = null;
  window.__ytReady = false;

  function safe(fn, fallback = null) {
    try { return fn(); } catch (_) { return fallback; }
  }

  window.onYouTubeIframeAPIReady = function () {
    player = new YT.Player('player', {
      height: size,
      width: size,
      host: youtubeHost,
      playerVars: {
        autoplay: 0,
        controls: 0,
        disablekb: 1,
        playsinline: 1,
        origin: window.location.origin
      },
      events: {
        onReady: function () {
          window.__ytReady = true;
          safe(() => player.setVolume(80));
          safe(() => player.unMute());
        },
        onStateChange: function (event) {
          if (!active) return;
          active.events.push({
            atMs: Date.now() - active.startedAt,
            state: event.data,
            currentTime: safe(() => player.getCurrentTime()),
            duration: safe(() => player.getDuration()),
          });
          if (event.data === YT.PlayerState.PLAYING && active.firstPlayingAtMs == null) {
            active.firstPlayingAtMs = Date.now() - active.startedAt;
            active.firstPlayingTime = safe(() => player.getCurrentTime(), 0) || 0;
          }
        },
        onError: function (event) {
          if (!active) return;
          active.errorCode = event.data;
          active.events.push({ atMs: Date.now() - active.startedAt, errorCode: event.data });
          active.finish('yt-error');
        }
      }
    });
  };

  window.probeVideo = function (opts) {
    return new Promise((resolve) => {
      const startedAt = Date.now();
      const result = {
        videoId: opts.videoId,
        ok: false,
        status: 'unknown',
        errorCode: null,
        errorLabel: null,
        firstPlayingAtMs: null,
        startTime: 0,
        endTime: 0,
        progressDelta: 0,
        duration: 0,
        finalState: null,
        volume: null,
        muted: null,
        firstPlayingTime: null,
        events: [],
      };

      let finished = false;
      const finish = (reason) => {
        if (finished) return;
        finished = true;
        clearTimeout(sampleTimer);
        clearTimeout(timeoutTimer);
        result.endTime = safe(() => player.getCurrentTime(), 0) || 0;
        result.duration = safe(() => player.getDuration(), 0) || 0;
        result.finalState = safe(() => player.getPlayerState(), null);
        result.volume = safe(() => player.getVolume(), null);
        result.muted = safe(() => player.isMuted(), null);
        result.errorCode = active?.errorCode ?? null;
        result.firstPlayingAtMs = active?.firstPlayingAtMs ?? null;
        result.firstPlayingTime = active?.firstPlayingTime ?? null;
        result.startTime = result.firstPlayingTime ?? 0;
        result.progressDelta = Math.max(0, result.endTime - result.startTime);
        result.errorLabel = result.errorCode ? (opts.errorLabels[String(result.errorCode)] || 'youtube-error') : null;

        if (result.errorCode) {
          result.status = 'yt-error';
        } else if (!Number.isFinite(result.duration) || result.duration <= 0) {
          result.status = 'no-duration';
        } else if (result.duration < opts.minDuration) {
          result.status = 'short-duration';
        } else if (result.firstPlayingAtMs == null) {
          result.status = reason === 'timeout' ? 'timeout-not-playing' : 'not-playing';
        } else if (result.progressDelta < opts.minProgress) {
          result.status = 'no-progress';
        } else {
          result.ok = true;
          result.status = 'ok';
        }

        safe(() => player.stopVideo());
        active = null;
        resolve(result);
      };

      active = {
        startedAt,
        events: result.events,
        firstPlayingAtMs: null,
        firstPlayingTime: null,
        errorCode: null,
        finish,
      };

      safe(() => player.setVolume(80));
      safe(() => player.unMute());
      safe(() => player.loadVideoById({ videoId: opts.videoId, startSeconds: 0 }));
      setTimeout(() => safe(() => player.playVideo()), 500);

      const sampleTimer = setTimeout(() => finish('sample-complete'), opts.sampleMs);
      const timeoutTimer = setTimeout(() => finish('timeout'), opts.timeoutMs);
    });
  };
</script>
<script src="https://www.youtube.com/iframe_api"></script>
</body>
</html>`
}

function startServer(html, listenHost) {
  const server = http.createServer((req, res) => {
    if (req.url === '/favicon.ico') {
      res.writeHead(204)
      res.end()
      return
    }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
    res.end(html)
  })
  return new Promise((resolve, reject) => {
    server.on('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      resolve({ server, url: `http://${listenHost}:${address.port}/` })
    })
  })
}

async function createProbePage(browser, url, args) {
  const page = await browser.newPage()
  page.setDefaultTimeout(args.timeoutMs + 10000)
  await page.goto(url, { waitUntil: 'domcontentloaded' })
  await page.waitForFunction(() => window.__ytReady === true, null, { timeout: args.timeoutMs })
  return page
}

async function probeTrack(page, track, args) {
  if (!track.youtubeVideoId) {
    return baseResult(track, {
      ok: false,
      status: 'missing-youtubeVideoId',
    })
  }

  try {
    const probe = await page.evaluate(
      ({ videoId, sampleMs, timeoutMs, minProgress, minDuration, errorLabels }) =>
        window.probeVideo({ videoId, sampleMs, timeoutMs, minProgress, minDuration, errorLabels }),
      {
        videoId: track.youtubeVideoId,
        sampleMs: args.sampleMs,
        timeoutMs: args.timeoutMs,
        minProgress: args.minProgress,
        minDuration: args.minDuration,
        errorLabels: Object.fromEntries(Object.entries(YT_ERROR).map(([key, value]) => [String(key), value])),
      },
    )
    return baseResult(track, probe)
  } catch (error) {
    return baseResult(track, {
      ok: false,
      status: 'probe-exception',
      exception: `${error.name || 'Error'}: ${error.message || error}`,
    })
  }
}

function baseResult(track, data) {
  return {
    id: track.id,
    index: track.index,
    key: track.key,
    artist: track.artist,
    title: track.title,
    youtubeVideoId: track.youtubeVideoId || null,
    ...data,
  }
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

function writeReports(reportPath, payload) {
  fs.mkdirSync(path.dirname(reportPath), { recursive: true })
  fs.writeFileSync(reportPath, JSON.stringify(payload, null, 2) + '\n', 'utf8')

  const failures = payload.results.filter((result) => !result.ok)
  const csvPath = reportPath.replace(/\.json$/i, '.failures.csv')
  const header = ['id', 'index', 'artist', 'title', 'youtubeVideoId', 'status', 'errorCode', 'errorLabel', 'duration', 'progressDelta']
  const lines = [header.join(',')]
  for (const row of failures) {
    lines.push(header.map((field) => csvCell(row[field])).join(','))
  }
  fs.writeFileSync(csvPath, lines.join('\n') + '\n', 'utf8')
}

function csvCell(value) {
  const text = value == null ? '' : String(value)
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

async function run() {
  const args = parseArgs(process.argv.slice(2))
  const selected = selectTracks(args)
  const startedAt = new Date()
  const html = buildProbeHtml(args)
  const { server, url } = await startServer(html, args.listenHost)
  const results = []
  let next = 0

  const browser = await chromium.launch({
    headless: !args.headful,
    args: ['--autoplay-policy=no-user-gesture-required'],
  })

  const payload = {
    checkedAt: startedAt.toISOString(),
    args,
    totalSelected: selected.length,
    summary: summarize(results),
    results,
  }

  async function worker(workerId) {
    const page = await createProbePage(browser, url, args)
    try {
      while (true) {
        const current = next
        next += 1
        if (current >= selected.length) break
        const track = selected[current]
        const result = await probeTrack(page, track, args)
        results.push(result)
        payload.summary = summarize(results)
        if (!args.quiet) {
          const marker = result.ok ? 'OK' : 'FAIL'
          console.log(`[${results.length}/${selected.length}] ${marker} ${track.artist} - ${track.title} -> ${result.status}`)
        }
        writeReports(args.report, payload)
      }
    } finally {
      await page.close().catch(() => {})
    }
  }

  try {
    const workers = Array.from({ length: Math.min(args.concurrency, Math.max(1, selected.length)) }, (_, index) => worker(index + 1))
    await Promise.all(workers)
  } finally {
    await browser.close().catch(() => {})
    server.close()
  }

  payload.finishedAt = new Date().toISOString()
  payload.elapsedSeconds = Math.round((Date.now() - startedAt.getTime()) / 100) / 10
  payload.summary = summarize(results)
  results.sort((a, b) => Number(a.index) - Number(b.index))
  writeReports(args.report, payload)
  console.log(JSON.stringify(payload.summary, null, 2))
}

run().catch((error) => {
  console.error(error)
  process.exit(1)
})
