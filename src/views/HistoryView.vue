<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { makeTrack } from '@/utils/track'
import { usePlayHistory } from '@/composables/usePlayHistory'
import { usePlayback } from '@/composables/usePlayback'
import TrackItem from '@/components/playlist/TrackItem.vue'
import type { Track } from '@/types/track.types'
import type { PlayHistoryEntry } from '@/types/playlist.types'

const { t, d } = useI18n()
const { history, clearHistory } = usePlayHistory()
const playback = usePlayback()

// La entrada de historial es ligera (artista/título/carátula); se hidrata a un
// Track efímero para reproducirla con la MISMA fila compartida que el resto de la
// app (TrackItem), en vez de reimplementar la fila aquí. enriched:true pinta la
// carátula ya (no el skeleton de "pendiente de enriquecer").
function toTrack(e: PlayHistoryEntry): Track {
  return makeTrack({ artist: e.artist, title: e.title, coverUrl: e.coverUrl, enriched: true })
}

function playEntry(track: Track): void {
  playback.startPlaylistQueue([track], 0, null)
}

function modeLabel(mode: string): string {
  return t(`history.mode.${mode}`)
}
const modeCls: Record<string, string> = {
  playlist: 'bg-sky-500/15 text-sky-300',
  radio: 'bg-brand/15 text-brand-soft',
  recommendations: 'bg-fuchsia-500/15 text-fuchsia-300'
}

function dayKey(ts: number): string {
  const date = new Date(ts)
  const today = new Date()
  const yest = new Date(); yest.setDate(today.getDate() - 1)
  if (date.toDateString() === today.toDateString()) return t('history.today')
  if (date.toDateString() === yest.toDateString()) return t('history.yesterday')
  return d(date, 'dayHeading')
}
function fmtTime(ts: number): string {
  return d(new Date(ts), 'time')
}

// Cada entrada lleva ya su Track hidratado (id estable dentro del render) para no
// recrearlo en cada repintado de la fila.
const grouped = computed(() => {
  const groups: { key: string; rows: { entry: PlayHistoryEntry; track: Track }[] }[] = []
  for (const entry of history.value) {
    const key = dayKey(entry.playedAt)
    const row = { entry, track: toTrack(entry) }
    const last = groups[groups.length - 1]
    if (last && last.key === key) last.rows.push(row)
    else groups.push({ key, rows: [row] })
  }
  return groups
})
</script>

<template>
  <div class="p-5 sm:p-8 max-w-3xl mx-auto">
    <header class="flex items-center justify-between mb-6">
      <div>
        <h1 class="font-display text-2xl sm:text-3xl font-extrabold">{{ $t('history.title') }}</h1>
        <p class="text-muted text-sm mt-1">{{ $t('history.subtitle') }}</p>
      </div>
      <button v-if="history.length" class="text-sm text-muted hover:text-white" @click="clearHistory()">{{ $t('history.clear') }}</button>
    </header>

    <div v-if="history.length === 0" class="rounded-2xl border border-dashed border-line p-10 text-center text-muted text-sm">
      {{ $t('history.empty') }}
    </div>

    <div v-for="group in grouped" :key="group.key" class="mb-6">
      <h2 class="text-xs font-semibold uppercase tracking-wider text-muted mb-2 capitalize">{{ group.key }}</h2>
      <ul class="flex flex-col">
        <TrackItem
          v-for="{ entry, track } in group.rows" :key="entry.id"
          :track="track" mode="radio" :show-index="false"
          @play="playEntry(track)"
        >
          <!-- A la derecha, en vez de año + duración: modo de reproducción y hora. -->
          <template #meta>
            <span class="text-[10px] px-2 py-0.5 rounded-full shrink-0" :class="modeCls[entry.queueMode]">
              {{ modeLabel(entry.queueMode) }}
            </span>
            <span class="text-xs text-muted tabular-nums shrink-0 w-12 text-right">{{ fmtTime(entry.playedAt) }}</span>
          </template>
        </TrackItem>
      </ul>
    </div>
  </div>
</template>
