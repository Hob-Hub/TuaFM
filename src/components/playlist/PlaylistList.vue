<script setup lang="ts">
import { RouterLink } from 'vue-router'
import { usePlaylists } from '@/composables/usePlaylists'
import { useUiStore } from '@/stores/ui.store'

const { playlists } = usePlaylists()
const ui = useUiStore()
</script>

<template>
  <div>
    <div class="flex items-center justify-between mb-4">
      <h2 class="font-display text-lg font-bold">{{ $t('playlist.listTitle') }}</h2>
      <button class="text-sm text-brand hover:underline" @click="ui.openCreatePlaylist()">{{ $t('playlist.newShort') }}</button>
    </div>

    <div v-if="playlists.length === 0" class="rounded-2xl border border-dashed border-line p-8 text-center">
      <p class="text-muted text-sm">{{ $t('playlist.emptyHint') }}</p>
      <button class="mt-3 text-brand text-sm font-medium hover:underline" @click="ui.openCreatePlaylist()">
        {{ $t('playlist.createCta') }}
      </button>
    </div>

    <div v-else class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
      <RouterLink
        v-for="pl in playlists" :key="pl.id"
        :to="{ name: 'playlist', params: { id: pl.id } }"
        class="group rounded-2xl bg-card hover:bg-card-hover border border-line p-3 transition-colors"
      >
        <div class="aspect-square rounded-xl bg-gradient-to-br from-brand/30 to-surface-2 mb-3 grid place-items-center overflow-hidden">
          <img v-if="pl.coverUrl" :src="pl.coverUrl" :alt="pl.name" class="w-full h-full object-cover" />
          <svg v-else viewBox="0 0 24 24" class="w-8 h-8 text-brand/60" fill="currentColor"><path d="M12 3v10.55A4 4 0 1 0 14 17V7h4V3h-6z"/></svg>
        </div>
        <p class="font-medium text-sm truncate group-hover:text-white">{{ pl.name }}</p>
        <p class="text-xs text-muted">{{ $t('common.songs', pl.trackIds.length) }}</p>
      </RouterLink>
    </div>
  </div>
</template>
