<script setup lang="ts">
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import PlaylistDetail from '@/components/playlist/PlaylistDetail.vue'

const route = useRoute()
const playlistId = computed(() => String(route.params.id))
</script>

<template>
  <div class="p-5 sm:p-8 max-w-5xl mx-auto">
    <!-- :key fuerza remount al navegar entre playlists (recrea el liveQuery) -->
    <PlaylistDetail :key="playlistId" :playlist-id="playlistId" />
  </div>
</template>
