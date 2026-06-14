<script setup lang="ts">
import BaseModal from '@/components/ui/BaseModal.vue'

defineEmits<{ close: [] }>()

// Cada fila: teclas + clave i18n de la acción. Las teclas no se traducen.
const rows: { keys: string[]; descKey: string }[] = [
  { keys: ['Space'], descKey: 'shortcuts.playPause' },
  { keys: ['←', '→'], descKey: 'shortcuts.seek' },
  { keys: ['Shift', '←', '→'], descKey: 'shortcuts.prevNext' },
  { keys: ['M'], descKey: 'shortcuts.mute' },
  { keys: ['F'], descKey: 'shortcuts.favorite' },
  { keys: ['?'], descKey: 'shortcuts.help' },
]
</script>

<template>
  <BaseModal :title="$t('shortcuts.title')" @close="$emit('close')">
    <ul class="flex flex-col gap-2.5">
      <li v-for="row in rows" :key="row.descKey" class="flex items-center justify-between gap-4">
        <span class="text-sm text-muted">{{ $t(row.descKey) }}</span>
        <span class="flex items-center gap-1 shrink-0">
          <kbd
            v-for="k in row.keys" :key="k"
            class="min-w-7 px-2 py-1 rounded-md bg-surface-2 border border-line text-xs font-medium text-white/90 text-center tabular-nums"
          >{{ k }}</kbd>
        </span>
      </li>
    </ul>
  </BaseModal>
</template>
