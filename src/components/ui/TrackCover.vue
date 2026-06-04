<script setup lang="ts">
import { ref, watch } from 'vue'

const props = withDefaults(defineProps<{
  src?:  string
  alt?:  string
  size?: number
  rounded?: string
}>(), { size: 48, rounded: 'rounded-lg' })

const failed = ref(false)
watch(() => props.src, () => { failed.value = false })
</script>

<template>
  <div
    class="relative shrink-0 overflow-hidden bg-surface-2 grid place-items-center"
    :class="rounded"
    :style="{ width: size + 'px', height: size + 'px' }"
  >
    <img
      v-if="src && !failed"
      :src="src"
      :alt="alt ?? ''"
      loading="lazy"
      class="w-full h-full object-cover"
      @error="failed = true"
    />
    <svg v-else viewBox="0 0 24 24" class="w-1/2 h-1/2 text-muted/50" fill="currentColor" aria-hidden="true">
      <path d="M12 3v10.55A4 4 0 1 0 14 17V7h4V3h-6z" />
    </svg>
  </div>
</template>
