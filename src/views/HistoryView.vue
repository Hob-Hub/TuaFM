<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { makeTrack } from '@/utils/track'
import { usePlayHistory } from '@/composables/usePlayHistory'
import { usePlayback } from '@/composables/usePlayback'
import TrackCover from '@/components/ui/TrackCover.vue'
import type { PlayHistoryEntry } from '@/types/playlist.types'

const { t, d } = useI18n()
const { history, clearHistory } = usePlayHistory()
const playback = usePlayback()

function playEntry(e: PlayHistoryEntry): void {
  playback.startPlaylistQueue(
    [makeTrack({ artist: e.artist, title: e.title, coverUrl: e.coverUrl })],
    0, null
  )
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

const grouped = computed(() => {
  const groups: { key: string; entries: PlayHistoryEntry[] }[] = []
  for (const entry of history.value) {
    const key = dayKey(entry.playedAt)
    const last = groups[groups.length - 1]
    if (last && last.key === key) last.entries.push(entry)
    else groups.push({ key, entries: [entry] })
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
        <li v-for="entry in group.entries" :key="entry.id"
            class="group flex items-center gap-3 px-3 py-2 rounded-xl hover:bg-card-hover cursor-pointer"
            @click="playEntry(entry)">
          <div class="relative shrink-0">
            <TrackCover :src="entry.coverUrl" :fallback-text="entry.title" :size="40" />
            <span class="absolute inset-0 grid place-items-center bg-black/40 rounded-lg opacity-0 group-hover:opacity-100 transition">
              <svg viewBox="0 0 24 24" class="w-4 h-4 ml-0.5 text-white" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
            </span>
          </div>
          <div class="min-w-0 flex-1">
            <p class="text-sm text-white truncate">{{ entry.title }}</p>
            <p class="text-xs text-muted truncate">{{ entry.artist }}</p>
          </div>
          <span class="text-[10px] px-2 py-0.5 rounded-full shrink-0" :class="modeCls[entry.queueMode]">
            {{ modeLabel(entry.queueMode) }}
          </span>
          <span class="text-xs text-muted tabular-nums shrink-0 w-12 text-right">{{ fmtTime(entry.playedAt) }}</span>
        </li>
      </ul>
    </div>
  </div>
</template>
