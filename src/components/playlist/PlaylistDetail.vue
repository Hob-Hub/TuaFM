<script setup lang="ts">
import { ref, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'
import { usePlaylists } from '@/composables/usePlaylists'
import { usePlayback } from '@/composables/usePlayback'
import { usePlayerStore } from '@/stores/player.store'
import { usePlaylistQueueStore } from '@/stores/playlistQueue.store'
import { useUiStore } from '@/stores/ui.store'
import { tracksToCsv, downloadTextFile, safeFilename } from '@/utils/csv'
import TrackItem from '@/components/playlist/TrackItem.vue'
import TrackCover from '@/components/ui/TrackCover.vue'
import BaseButton from '@/components/ui/BaseButton.vue'

const props = defineProps<{ playlistId: string }>()

const { observePlaylistDetail, removeTrackAt, reorderTracks, deletePlaylist } = usePlaylists()
const playback = usePlayback()
const player = usePlayerStore()
const pq = usePlaylistQueueStore()
const ui = useUiStore()
const router = useRouter()
const { t } = useI18n()

const data = observePlaylistDetail(props.playlistId)
const playlist = computed(() => data.value.playlist)
const tracks = computed(() => data.value.tracks)
const coverFromTracks = computed(() => tracks.value.find(t => t.coverUrl)?.coverUrl)

const dragIndex = ref<number | null>(null)

function isActiveRow(index: number): boolean {
  return player.queueMode === 'playlist'
    && pq.playlistId === props.playlistId
    && pq.currentIndex === index
}

function play(index: number): void {
  playback.startPlaylistQueue([...tracks.value], index, props.playlistId)
}
function playAll(): void {
  if (tracks.value.length) play(0)
}

function exportCsv(): void {
  if (!playlist.value || !tracks.value.length) return
  const csv = tracksToCsv(
    tracks.value.map(t => ({ artist: t.artistDisplay ?? t.artist, title: t.titleDisplay ?? t.title })),
  )
  downloadTextFile(safeFilename(playlist.value.name, 'csv'), csv)
}

async function confirmDelete(): Promise<void> {
  const name = playlist.value?.name ?? t('playlist.fallbackName')
  if (!window.confirm(t('playlist.confirmDelete', { name }))) return
  await deletePlaylist(props.playlistId)
  ui.showToast(t('playlist.deleted'), 'success')
  router.push({ name: 'home' })
}

function onDrop(index: number): void {
  if (dragIndex.value === null || dragIndex.value === index || !playlist.value) return
  const order = [...playlist.value.trackIds]
  const [moved] = order.splice(dragIndex.value, 1)
  order.splice(index, 0, moved)
  void reorderTracks(props.playlistId, order)
  dragIndex.value = null
}
</script>

<template>
  <div v-if="playlist">
    <!-- Cabecera -->
    <header class="flex items-end gap-5 mb-6">
      <TrackCover :src="playlist.coverUrl ?? coverFromTracks" :fallback-text="playlist.name" :size="160" rounded="rounded-2xl" />
      <div class="min-w-0 pb-1">
        <p class="text-xs uppercase tracking-wider text-muted">{{ $t('playlist.label') }}</p>
        <h1 class="font-display text-3xl sm:text-4xl font-extrabold truncate">{{ playlist.name }}</h1>
        <p class="text-sm text-muted mt-2">{{ $t('common.songs', tracks.length) }}</p>
      </div>
    </header>

    <!-- Acciones -->
    <div class="flex items-center gap-2 mb-6 flex-wrap">
      <BaseButton variant="brand" size="lg" :disabled="!tracks.length" @click="playAll">
        <svg viewBox="0 0 24 24" class="w-5 h-5" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
        {{ $t('playlist.play') }}
      </BaseButton>
      <BaseButton variant="surface" @click="ui.openAddTrack(playlistId)">
        <svg viewBox="0 0 24 24" class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 5v14M5 12h14"/></svg>
        {{ $t('playlist.add') }}
      </BaseButton>
      <BaseButton variant="surface" @click="ui.openCsvImport(playlistId)">
        <svg viewBox="0 0 24 24" class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 16V4M6 10l6-6 6 6M4 20h16"/></svg>
        {{ $t('playlist.importCsv') }}
      </BaseButton>
      <BaseButton variant="surface" :disabled="!tracks.length" @click="exportCsv">
        <svg viewBox="0 0 24 24" class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 4v12M6 10l6 6 6-6M4 20h16"/></svg>
        {{ $t('playlist.exportCsv') }}
      </BaseButton>
      <BaseButton variant="danger" class="ml-auto" @click="confirmDelete">{{ $t('playlist.delete') }}</BaseButton>
    </div>

    <!-- Lista -->
    <div v-if="tracks.length === 0" class="rounded-2xl border border-dashed border-line p-10 text-center text-muted text-sm">
      {{ $t('playlist.empty') }}
    </div>
    <ul v-else class="flex flex-col">
      <li
        v-for="(track, i) in tracks" :key="track.id"
        draggable="true"
        @dragstart="dragIndex = i"
        @dragover.prevent
        @drop="onDrop(i)"
      >
        <TrackItem
          :track="track"
          mode="playlist"
          :index="i"
          :is-active="isActiveRow(i)"
          :is-playing="isActiveRow(i) && player.isPlaying"
          removable
          @play="play(i)"
          @remove="removeTrackAt(playlistId, i)"
        />
      </li>
    </ul>
  </div>

  <div v-else class="grid place-items-center py-20 text-muted">
    <p>{{ $t('playlist.notFound') }}</p>
  </div>
</template>
