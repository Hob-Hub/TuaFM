<script setup lang="ts">
import { computed } from 'vue'
import { usePlayHistory } from '@/composables/usePlayHistory'
import TrackCover from '@/components/ui/TrackCover.vue'
import type { PlayHistoryEntry } from '@/types/playlist.types'

const { history, clearHistory } = usePlayHistory()

const modeLabel: Record<string, string> = {
  playlist: 'Playlist', radio: 'Radio', recommendations: 'Recs'
}
const modeCls: Record<string, string> = {
  playlist: 'bg-sky-500/15 text-sky-300',
  radio: 'bg-brand/15 text-brand-soft',
  recommendations: 'bg-fuchsia-500/15 text-fuchsia-300'
}

function dayKey(ts: number): string {
  const d = new Date(ts)
  const today = new Date()
  const yest = new Date(); yest.setDate(today.getDate() - 1)
  if (d.toDateString() === today.toDateString()) return 'Hoy'
  if (d.toDateString() === yest.toDateString()) return 'Ayer'
  return d.toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' })
}
function fmtTime(ts: number): string {
  return new Date(ts).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })
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
        <h1 class="font-display text-2xl sm:text-3xl font-extrabold">Historial</h1>
        <p class="text-muted text-sm mt-1">Tus últimas reproducciones.</p>
      </div>
      <button v-if="history.length" class="text-sm text-muted hover:text-white" @click="clearHistory()">Vaciar</button>
    </header>

    <div v-if="history.length === 0" class="rounded-2xl border border-dashed border-line p-10 text-center text-muted text-sm">
      Todavía no has reproducido nada.
    </div>

    <div v-for="group in grouped" :key="group.key" class="mb-6">
      <h2 class="text-xs font-semibold uppercase tracking-wider text-muted mb-2 capitalize">{{ group.key }}</h2>
      <ul class="flex flex-col">
        <li v-for="entry in group.entries" :key="entry.id"
            class="flex items-center gap-3 px-3 py-2 rounded-xl hover:bg-card-hover">
          <TrackCover :src="entry.coverUrl" :size="40" />
          <div class="min-w-0 flex-1">
            <p class="text-sm text-white truncate">{{ entry.title }}</p>
            <p class="text-xs text-muted truncate">{{ entry.artist }}</p>
          </div>
          <span class="text-[10px] px-2 py-0.5 rounded-full shrink-0" :class="modeCls[entry.queueMode]">
            {{ modeLabel[entry.queueMode] }}
          </span>
          <span class="text-xs text-muted tabular-nums shrink-0 w-12 text-right">{{ fmtTime(entry.playedAt) }}</span>
        </li>
      </ul>
    </div>
  </div>
</template>
