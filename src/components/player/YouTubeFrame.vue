<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useYouTubePlayer } from '@/composables/useYouTubePlayer'

// El IFrame de YouTube se monta una sola vez (en App.vue). YT reemplaza el div
// hijo por un <iframe>. Lo mantenemos fuera de pantalla, pero con tamaño real:
// algunos vídeos fallan o quedan sin audio si el iframe se inicializa a 0x0.
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
    class="fixed top-0 -left-[9999px] w-[200px] h-[200px] overflow-hidden pointer-events-none opacity-0"
  />
</template>
