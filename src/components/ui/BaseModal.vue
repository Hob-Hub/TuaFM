<script setup lang="ts">
import { onMounted, onBeforeUnmount } from 'vue'

const props = defineProps<{ title?: string }>()
const emit = defineEmits<{ close: [] }>()

function onKey(e: KeyboardEvent): void {
  if (e.key === 'Escape') emit('close')
}
onMounted(() => document.addEventListener('keydown', onKey))
onBeforeUnmount(() => document.removeEventListener('keydown', onKey))
void props
</script>

<template>
  <div class="fixed inset-0 z-50 grid place-items-center p-4" role="dialog" aria-modal="true">
    <div class="absolute inset-0 bg-black/60 backdrop-blur-sm" @click="emit('close')" />
    <div class="relative w-full max-w-md bg-card border border-line rounded-2xl shadow-2xl overflow-hidden">
      <header v-if="title || $slots.header" class="flex items-center justify-between px-5 py-4 border-b border-line">
        <h2 class="font-display text-lg font-bold">
          <slot name="header">{{ title }}</slot>
        </h2>
        <button class="p-1.5 rounded-lg text-muted hover:text-white hover:bg-white/10" :aria-label="$t('nowPlaying.close')" @click="emit('close')">
          <svg viewBox="0 0 24 24" class="w-5 h-5" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 6l12 12M18 6 6 18"/></svg>
        </button>
      </header>
      <div class="p-5">
        <slot />
      </div>
      <footer v-if="$slots.footer" class="px-5 py-4 border-t border-line flex justify-end gap-2">
        <slot name="footer" />
      </footer>
    </div>
  </div>
</template>
