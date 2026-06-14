<script setup lang="ts">
import { ref, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { usePlaylists } from '@/composables/usePlaylists'
import { useUiStore } from '@/stores/ui.store'
import BaseModal from '@/components/ui/BaseModal.vue'
import BaseButton from '@/components/ui/BaseButton.vue'

const ui = useUiStore()
const { t } = useI18n()
const { playlists, addTrack, addTracks, createPlaylist } = usePlaylists()
const creating = ref(false)
const newName = ref('')

const batch = computed(() => ui.saveToPlaylistTracks)

async function saveTo(playlistId: string): Promise<void> {
  if (batch.value) {
    await addTracks(playlistId, batch.value)
    ui.showToast(t('saveToPlaylist.savedMany', batch.value.length), 'success')
    ui.closeSaveToPlaylist()
    return
  }
  const track = ui.saveToPlaylistTrack
  if (!track) return
  await addTrack(playlistId, track)
  ui.showToast(t('saveToPlaylist.saved'), 'success')
  ui.closeSaveToPlaylist()
}

async function createAndSave(): Promise<void> {
  if (!newName.value.trim()) return
  const id = await createPlaylist(newName.value)
  newName.value = ''
  creating.value = false
  await saveTo(id)
}
</script>

<template>
  <BaseModal :title="$t('saveToPlaylist.title')" @close="ui.closeSaveToPlaylist()">
    <p v-if="batch" class="text-sm text-muted mb-4 truncate">
      <span class="text-white">{{ ui.saveToPlaylistLabel || $t('saveToPlaylist.batchFallback') }}</span>
      · {{ $t('common.songs', batch.length) }}
    </p>
    <p v-else-if="ui.saveToPlaylistTrack" class="text-sm text-muted mb-4 truncate">
      <span class="text-white">{{ ui.saveToPlaylistTrack.title }}</span>
      · {{ ui.saveToPlaylistTrack.artistDisplay ?? ui.saveToPlaylistTrack.artist }}
    </p>

    <ul class="flex flex-col gap-1 max-h-64 overflow-y-auto -mx-1 px-1">
      <li v-for="pl in playlists" :key="pl.id">
        <button
          class="w-full flex items-center justify-between px-3 h-11 rounded-xl text-sm
                 text-white/90 hover:bg-card-hover transition text-left"
          @click="saveTo(pl.id)"
        >
          <span class="truncate">{{ pl.name }}</span>
          <span class="text-xs text-muted">{{ pl.trackIds.length }}</span>
        </button>
      </li>
      <li v-if="playlists.length === 0" class="text-sm text-muted/70 px-3 py-2">
        {{ $t('saveToPlaylist.empty') }}
      </li>
    </ul>

    <div class="mt-4 pt-4 border-t border-line">
      <div v-if="creating" class="flex gap-2">
        <input
          v-model="newName" :placeholder="$t('saveToPlaylist.newNamePlaceholder')"
          class="flex-1 h-10 px-3 rounded-xl bg-surface-2 border border-line text-sm focus:outline-none focus:border-brand/70"
          @keyup.enter="createAndSave"
        />
        <BaseButton variant="brand" size="sm" :disabled="!newName.trim()" @click="createAndSave">{{ $t('common.create') }}</BaseButton>
      </div>
      <BaseButton v-else variant="ghost" size="sm" @click="creating = true">
        <svg viewBox="0 0 24 24" class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 5v14M5 12h14"/></svg>
        {{ $t('saveToPlaylist.newPlaylist') }}
      </BaseButton>
    </div>
  </BaseModal>
</template>
