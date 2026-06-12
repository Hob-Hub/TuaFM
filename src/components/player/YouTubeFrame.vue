<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useYouTubePlayer } from '@/composables/useYouTubePlayer'

// Dos IFrames de YouTube (reproducción gapless: uno suena, el otro pre-bufferiza
// la siguiente). YT reemplaza cada div hijo por un <iframe>. Fuera de pantalla
// pero con tamaño real: algunos vídeos fallan o quedan sin audio a 0x0.
const host = ref<HTMLDivElement | null>(null)
const yt = useYouTubePlayer()

onMounted(async () => {
  const mountA = document.createElement('div')
  const mountB = document.createElement('div')
  host.value?.appendChild(mountA)
  host.value?.appendChild(mountB)
  await yt.init(mountA, mountB)
})
</script>

<template>
  <div
    ref="host"
    aria-hidden="true"
    class="fixed top-0 -left-[9999px] w-[200px] h-[420px] pointer-events-none opacity-0"
  />
</template>
