<script setup lang="ts">
import { ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { searchTrack, type TrackSearchResult } from '@/services/lastfm.service'
import { usePlaylists } from '@/composables/usePlaylists'
import { useUiStore } from '@/stores/ui.store'
import { makeTrack } from '@/utils/track'
import BaseModal from '@/components/ui/BaseModal.vue'
import TrackCover from '@/components/ui/TrackCover.vue'

const ui = useUiStore()
const { addTrack } = usePlaylists()
const { t } = useI18n()

const query = ref('')
const results = ref<TrackSearchResult[]>([])
const loading = ref(false)
const added = ref<Set<string>>(new Set())
let timer: ReturnType<typeof setTimeout> | null = null
let activeController: AbortController | null = null

watch(query, (q) => {
  if (timer) clearTimeout(timer)
  if (!q.trim()) { activeController?.abort(); results.value = []; return }
  timer = setTimeout(runSearch, 350)
})

async function runSearch(): Promise<void> {
  activeController?.abort()
  const controller = new AbortController()
  activeController = controller
  loading.value = true
  try {
    const found = await searchTrack(query.value, 20, controller.signal)
    if (!controller.signal.aborted) results.value = found
  } catch {
    if (!controller.signal.aborted) results.value = []
  } finally {
    if (!controller.signal.aborted) loading.value = false
  }
}

async function add(r: TrackSearchResult): Promise<void> {
  const pid = ui.addTrackPlaylistId
  if (!pid) return
  await addTrack(pid, makeTrack({
    artist: r.artist, title: r.title, coverUrl: r.coverUrl
  }))
  added.value.add(`${r.artist}::${r.title}`)
  ui.showToast(t('addTrack.added'), 'success')
}
</script>

<template>
  <BaseModal :title="$t('addTrack.title')" @close="ui.closeAddTrack()">
    <input
      v-model="query"
      autofocus
      :placeholder="$t('addTrack.placeholder')"
      :aria-label="$t('addTrack.aria')"
      class="w-full h-11 px-4 rounded-xl bg-surface-2 border border-line text-sm
             focus:outline-none focus:border-brand/70 focus:ring-2 focus:ring-brand/30"
    />

    <div class="mt-4 max-h-80 overflow-y-auto -mx-1 px-1">
      <p v-if="loading" class="text-sm text-muted py-6 text-center">{{ $t('addTrack.searching') }}</p>
      <p v-else-if="query && results.length === 0" class="text-sm text-muted py-6 text-center">{{ $t('addTrack.noResults') }}</p>

      <ul v-else class="flex flex-col gap-1">
        <li v-for="r in results" :key="`${r.artist}-${r.title}`"
            class="flex items-center gap-3 px-2 py-1.5 rounded-xl hover:bg-card-hover">
          <TrackCover :src="r.coverUrl" :fallback-text="r.title" :size="40" />
          <div class="min-w-0 flex-1">
            <p class="text-sm text-white truncate">{{ r.title }}</p>
            <p class="text-xs text-muted truncate">{{ r.artist }}</p>
          </div>
          <button
            class="p-2 rounded-lg shrink-0 transition"
            :class="added.has(`${r.artist}::${r.title}`) ? 'text-brand' : 'text-muted hover:bg-white/10 hover:text-white'"
            :aria-label="$t('addTrack.addAria', { title: r.title })"
            @click="add(r)"
          >
            <svg v-if="added.has(`${r.artist}::${r.title}`)" viewBox="0 0 24 24" class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 12l4 4L19 7"/></svg>
            <svg v-else viewBox="0 0 24 24" class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 5v14M5 12h14"/></svg>
          </button>
        </li>
      </ul>
    </div>
  </BaseModal>
</template>
