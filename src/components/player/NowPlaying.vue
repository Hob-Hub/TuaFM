<script setup lang="ts">
import { RouterLink } from 'vue-router'
import type { Track } from '@/types/track.types'
import TrackCover from '@/components/ui/TrackCover.vue'

defineProps<{ track: Track | null }>()
</script>

<template>
  <div class="flex items-center gap-3 min-w-0">
    <TrackCover :src="track?.coverUrl" :alt="track?.album" :size="52" rounded="rounded-lg" />
    <div v-if="track" class="min-w-0">
      <p class="font-medium text-sm text-white truncate">{{ track.title }}</p>
      <RouterLink
        :to="{ name: 'artist', params: { name: track.artistDisplay ?? track.artist } }"
        class="text-xs text-muted truncate hover:text-white/80 hover:underline block"
      >
        {{ track.artistDisplay ?? track.artist }}
      </RouterLink>
    </div>
    <div v-else class="min-w-0">
      <p class="text-sm text-muted">Nada sonando</p>
      <p class="text-xs text-muted/60">Elige una canción para empezar</p>
    </div>
  </div>
</template>
