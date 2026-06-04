<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useYouTubePlayer } from '@/composables/useYouTubePlayer'

// El IFrame de YouTube se monta una sola vez (en App.vue). YT reemplaza el div
// hijo por un <iframe>. Lo mantenemos fuera de pantalla: solo necesitamos audio.
const host = ref<HTMLDivElement | null>(null)
const yt = useYouTubePlayer()

onMounted(async () => {
  const mount = document.createElement('div')
  host.value?.appendChild(mount)
  await yt.init(mount)
})
</script>

<template>
  <div
    ref="host"
    aria-hidden="true"
    class="fixed bottom-0 left-0 w-0 h-0 overflow-hidden pointer-events-none opacity-0"
  />
</template>
