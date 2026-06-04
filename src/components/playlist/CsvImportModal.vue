<script setup lang="ts">
import { ref, computed } from 'vue'
import { useCsvImport } from '@/composables/useCsvImport'
import { usePlaylists } from '@/composables/usePlaylists'
import { useUiStore } from '@/stores/ui.store'
import BaseModal from '@/components/ui/BaseModal.vue'
import BaseButton from '@/components/ui/BaseButton.vue'

const ui = useUiStore()
const { rows, parsing, parseFile, parseText, toTracks } = useCsvImport()
const { addTracks } = usePlaylists()

const fileName = ref('')
const pasted = ref('')
const importing = ref(false)

const validCount = computed(() => rows.value.filter(r => r.valid).length)
const invalidCount = computed(() => rows.value.length - validCount.value)

async function onFile(e: Event): Promise<void> {
  const file = (e.target as HTMLInputElement).files?.[0]
  if (!file) return
  fileName.value = file.name
  pasted.value = ''
  await parseFile(file)
}

function onPaste(): void {
  fileName.value = ''
  if (pasted.value.trim()) parseText(pasted.value)
  else rows.value = []
}

async function confirm(): Promise<void> {
  const pid = ui.csvImportPlaylistId
  if (!pid || validCount.value === 0) return
  importing.value = true
  await addTracks(pid, toTracks(rows.value))
  importing.value = false
  ui.showToast(`${validCount.value} canciones importadas`, 'success')
  ui.closeCsvImport()
}
</script>

<template>
  <BaseModal title="Importar CSV" @close="ui.closeCsvImport()">
    <p class="text-sm text-muted mb-3 leading-relaxed">
      Dos columnas: <span class="text-white/90">artista, título</span>. Sin cabecera obligatoria.
    </p>

    <label class="block mb-3">
      <span class="inline-flex items-center gap-2 px-4 h-10 rounded-xl bg-surface-2 border border-line text-sm cursor-pointer hover:bg-card-hover">
        <svg viewBox="0 0 24 24" class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 16V4M6 10l6-6 6 6M4 20h16"/></svg>
        {{ fileName || 'Elegir archivo .csv' }}
      </span>
      <input type="file" accept=".csv,text/csv" class="hidden" @change="onFile" />
    </label>

    <details class="mb-3">
      <summary class="text-xs text-muted cursor-pointer hover:text-white/80">…o pegar texto directamente</summary>
      <textarea
        v-model="pasted"
        rows="5"
        placeholder="Radiohead,Creep&#10;Oasis,Wonderwall"
        class="mt-2 w-full p-3 rounded-xl bg-surface-2 border border-line text-sm font-mono
               focus:outline-none focus:border-brand/70 resize-none"
        @input="onPaste"
      />
    </details>

    <div v-if="parsing" class="text-sm text-muted py-3">Procesando…</div>
    <div v-else-if="rows.length" class="rounded-xl bg-surface-2 border border-line overflow-hidden">
      <div class="flex items-center justify-between px-3 py-2 text-xs border-b border-line">
        <span class="text-emerald-400">{{ validCount }} válidas</span>
        <span v-if="invalidCount" class="text-amber-400">{{ invalidCount }} ignoradas</span>
      </div>
      <ul class="max-h-44 overflow-y-auto divide-y divide-line/50">
        <li v-for="r in rows.slice(0, 100)" :key="r.line"
            class="flex items-center gap-2 px-3 py-1.5 text-sm"
            :class="!r.valid && 'opacity-40'">
          <span class="w-6 text-[10px] text-muted tabular-nums">{{ r.line }}</span>
          <span class="text-white truncate flex-1">{{ r.title || '—' }}</span>
          <span class="text-muted truncate flex-1">{{ r.artist || '—' }}</span>
        </li>
      </ul>
    </div>

    <template #footer>
      <BaseButton variant="ghost" @click="ui.closeCsvImport()">Cancelar</BaseButton>
      <BaseButton variant="brand" :disabled="validCount === 0 || importing" @click="confirm">
        Importar {{ validCount || '' }}
      </BaseButton>
    </template>
  </BaseModal>
</template>
