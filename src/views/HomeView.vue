<script setup lang="ts">
import { RouterLink } from 'vue-router'
import PlaylistList from '@/components/playlist/PlaylistList.vue'

const shortcuts = [
  { name: 'radio', label: 'Radio', desc: 'La máquina del tiempo sonora', to: { name: 'radio' },
    cls: 'from-brand/40 to-surface-2', icon: 'M4 8h16v11H4zM8 4l8 3' },
  { name: 'recs', label: 'Recomendaciones', desc: 'El oráculo de Last.fm', to: { name: 'recs' },
    cls: 'from-fuchsia-500/30 to-surface-2', icon: 'M12 2l2.4 7.4H22l-6 4.4 2.3 7.2L12 16.6 5.7 21l2.3-7.2-6-4.4h7.6z' }
]
</script>

<template>
  <div class="p-5 sm:p-8 max-w-6xl mx-auto space-y-8">
    <header>
      <h1 class="font-display text-2xl sm:text-3xl font-extrabold">Tu radio imaginaria</h1>
      <p class="text-muted text-sm mt-1">Construida desde los charts reales. Explora, escucha, colecciona.</p>
    </header>

    <div class="grid sm:grid-cols-2 gap-3">
      <RouterLink
        v-for="s in shortcuts" :key="s.name" :to="s.to"
        class="group relative overflow-hidden rounded-2xl border border-line p-5 bg-gradient-to-br transition-transform hover:scale-[1.01]"
        :class="s.cls"
      >
        <svg viewBox="0 0 24 24" class="w-8 h-8 text-white/90 mb-8" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path :d="s.icon"/></svg>
        <p class="font-display text-xl font-bold">{{ s.label }}</p>
        <p class="text-sm text-white/70">{{ s.desc }}</p>
      </RouterLink>
    </div>

    <PlaylistList />
  </div>
</template>
