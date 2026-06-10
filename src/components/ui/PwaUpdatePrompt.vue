<script setup lang="ts">
import { useRegisterSW } from 'virtual:pwa-register/vue'
import BaseButton from '@/components/ui/BaseButton.vue'

// registerType: 'prompt' → no recargamos solos (cortaría la reproducción).
// needRefresh se vuelve true cuando hay un service worker nuevo esperando;
// el usuario aplica la actualización cuando quiere con updateServiceWorker().
const { needRefresh, updateServiceWorker } = useRegisterSW()

function reload(): void {
  // true = recargar la página tras activar el SW nuevo.
  void updateServiceWorker(true)
}
</script>

<template>
  <Transition name="toast">
    <div
      v-if="needRefresh"
      class="fixed bottom-28 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3
             px-4 py-2.5 rounded-xl text-sm shadow-xl border bg-card border-line text-white"
      role="status"
    >
      <span>Nueva versión disponible.</span>
      <BaseButton variant="brand" size="sm" @click="reload">Recargar</BaseButton>
      <button
        class="text-white/50 hover:text-white/80 transition-colors"
        aria-label="Descartar"
        @click="needRefresh = false"
      >
        ✕
      </button>
    </div>
  </Transition>
</template>
