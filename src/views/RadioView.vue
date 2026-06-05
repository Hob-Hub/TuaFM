<script setup lang="ts">
import RadioControls from '@/components/radio/RadioControls.vue'
import RadioQueueView from '@/components/radio/RadioQueueView.vue'
</script>

<template>
  <div class="p-5 sm:p-8 max-w-5xl mx-auto">
    <header class="mb-6">
      <h1 class="font-display text-2xl sm:text-3xl font-extrabold">Radio</h1>
      <p class="text-muted text-sm mt-1">La máquina del tiempo sonora — cómo habría sonado la radio ese año.</p>
    </header>

    <div class="grid lg:grid-cols-[360px_1fr] gap-6 items-start">
      <RadioControls />
      <RadioQueueView />
    </div>
  </div>
</template>
