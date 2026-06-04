<script setup lang="ts">
import { ref, computed } from 'vue'
import { usePlaylists } from '@/composables/usePlaylists'
import { usePlayback } from '@/composables/usePlayback'
import { usePlayerStore } from '@/stores/player.store'
import { useUiStore } from '@/stores/ui.store'
import TrackItem from '@/components/playlist/TrackItem.vue'
import TrackCover from '@/components/ui/TrackCover.vue'
import BaseButton from '@/components/ui/BaseButton.vue'

const props = defineProps<{ playlistId: string }>()

const { observePlaylistDetail, removeTrackAt, reorderTracks, deletePlaylist } = usePlaylists()
const playback = usePlayback()
const player = usePlayerStore()
const ui = useUiStore()

const data = observePlaylistDetail(props.playlistId)
const playlist = computed(() => data.value.playlist)
const tracks = computed(() => data.value.tracks)
const coverFromTracks = computed(() => tracks.value.find(t => t.coverUrl)?.coverUrl)

const dragIndex = ref<number | null>(null)

function isActiveRow(index: number): boolean {
  return player.queueMode === 'playlist'
    && player.currentPlaylistId === props.playlistId
    && playback.playlistIndex.value === index
}

function play(index: number): void {
  playback.startPlaylistQueue([...tracks.value], index, props.playlistId)
}
function playAll(): void {
  if (tracks.value.length) play(0)
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
      <TrackCover :src="playlist.coverUrl ?? coverFromTracks" :size="160" rounded="rounded-2xl" />
      <div class="min-w-0 pb-1">
        <p class="text-xs uppercase tracking-wider text-muted">Playlist</p>
        <h1 class="font-display text-3xl sm:text-4xl font-extrabold truncate">{{ playlist.name }}</h1>
        <p class="text-sm text-muted mt-2">{{ tracks.length }} canciones</p>
      </div>
    </header>

    <!-- Acciones -->
    <div class="flex items-center gap-2 mb-6 flex-wrap">
      <BaseButton variant="brand" size="lg" :disabled="!tracks.length" @click="playAll">
        <svg viewBox="0 0 24 24" class="w-5 h-5" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
        Reproducir
      </BaseButton>
      <BaseButton variant="surface" @click="ui.openAddTrack(playlistId)">
        <svg viewBox="0 0 24 24" class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 5v14M5 12h14"/></svg>
        Añadir
      </BaseButton>
      <BaseButton variant="surface" @click="ui.openCsvImport(playlistId)">
        <svg viewBox="0 0 24 24" class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 16V4M6 10l6-6 6 6M4 20h16"/></svg>
        Importar CSV
      </BaseButton>
      <BaseButton variant="danger" class="ml-auto" @click="deletePlaylist(playlistId)">Eliminar</BaseButton>
    </div>

    <!-- Lista -->
    <div v-if="tracks.length === 0" class="rounded-2xl border border-dashed border-line p-10 text-center text-muted text-sm">
      Esta playlist está vacía. Añade canciones o importa un CSV.
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
    <p>Playlist no encontrada.</p>
  </div>
</template>
