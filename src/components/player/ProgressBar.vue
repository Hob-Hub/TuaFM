<script setup lang="ts">
import { computed } from 'vue'
import { usePlayerStore } from '@/stores/player.store'
import { useYouTubePlayer } from '@/composables/useYouTubePlayer'
import BaseSlider from '@/components/ui/BaseSlider.vue'

withDefaults(defineProps<{ compact?: boolean }>(), { compact: false })

const player = usePlayerStore()
const yt = useYouTubePlayer()

function fmt(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return '0:00'
  const m = Math.floor(sec / 60)
  const s = Math.floor(sec % 60)
  return `${m}:${String(s).padStart(2, '0')}`
}

const progress = computed(() => player.progress)

function onSeek(pct: number): void {
  if (player.duration > 0) yt.seekTo((pct / 100) * player.duration)
}
</script>

<template>
  <div class="flex items-center gap-2 w-full">
    <span v-if="!compact" class="text-[11px] tabular-nums text-muted w-9 text-right">{{ fmt(player.currentTime) }}</span>
    <BaseSlider
      class="flex-1"
      :model-value="progress"
      :min="0" :max="100" :step="0.1"
      aria-label="Posición de reproducción"
      @update:model-value="onSeek"
    />
    <span v-if="!compact" class="text-[11px] tabular-nums text-muted w-9">{{ fmt(player.duration) }}</span>
  </div>
</template>
