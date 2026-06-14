<script setup lang="ts">
import { ref } from 'vue'
import { onClickOutside } from '@vueuse/core'
import { useSleepTimer } from '@/composables/useSleepTimer'

const { steps, active, remainingLabel, start, cancel } = useSleepTimer()

const open = ref(false)
const root = ref<HTMLElement | null>(null)
onClickOutside(root, () => { open.value = false })

function choose(minutes: number): void {
  start(minutes)
  open.value = false
}
function turnOff(): void {
  cancel()
  open.value = false
}
</script>

<template>
  <div ref="root" class="relative">
    <button
      class="flex items-center gap-1 px-1.5 h-8 rounded-lg transition-colors"
      :class="active ? 'text-brand' : 'text-muted hover:text-white'"
      :title="$t('sleep.title')"
      :aria-label="active ? $t('sleep.activeAria', { min: remainingLabel }) : $t('sleep.enableAria')"
      @click="open = !open"
    >
      <svg viewBox="0 0 24 24" class="w-5 h-5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9z" />
      </svg>
      <span v-if="active" class="text-xs font-semibold tabular-nums">{{ remainingLabel }}</span>
    </button>

    <div
      v-if="open"
      class="absolute bottom-full right-0 mb-2 w-44 rounded-xl bg-card border border-line shadow-2xl p-1.5 z-30"
      role="menu"
    >
      <p class="px-2.5 py-1.5 text-xs font-semibold uppercase tracking-wider text-muted">{{ $t('sleep.title') }}</p>
      <button
        v-for="m in steps" :key="m"
        class="w-full text-left px-2.5 py-2 rounded-lg text-sm text-white/90 hover:bg-card-hover transition-colors"
        role="menuitem"
        @click="choose(m)"
      >
        {{ $t('sleep.minutes', { min: m }) }}
      </button>
      <button
        v-if="active"
        class="w-full text-left px-2.5 py-2 rounded-lg text-sm text-red-400 hover:bg-red-500/10 transition-colors"
        role="menuitem"
        @click="turnOff"
      >
        {{ $t('sleep.off', { min: remainingLabel }) }}
      </button>
    </div>
  </div>
</template>
