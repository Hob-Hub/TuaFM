<script setup lang="ts">
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { usePlaylists } from '@/composables/usePlaylists'
import { useUiStore } from '@/stores/ui.store'
import BaseModal from '@/components/ui/BaseModal.vue'
import BaseInput from '@/components/ui/BaseInput.vue'
import BaseButton from '@/components/ui/BaseButton.vue'

const ui = useUiStore()
const router = useRouter()
const { createPlaylist } = usePlaylists()

const name = ref('')
const busy = ref(false)

async function submit(): Promise<void> {
  if (!name.value.trim() || busy.value) return
  busy.value = true
  const id = await createPlaylist(name.value)
  busy.value = false
  ui.closeCreatePlaylist()
  name.value = ''
  router.push({ name: 'playlist', params: { id } })
}
</script>

<template>
  <BaseModal title="Nueva playlist" @close="ui.closeCreatePlaylist()">
    <form @submit.prevent="submit">
      <BaseInput
        v-model="name"
        label="Nombre"
        placeholder="Ej. Veranos de los 2000"
        aria-label="Nombre de la playlist"
      />
    </form>
    <template #footer>
      <BaseButton variant="ghost" @click="ui.closeCreatePlaylist()">Cancelar</BaseButton>
      <BaseButton variant="brand" :disabled="!name.trim() || busy" @click="submit">Crear</BaseButton>
    </template>
  </BaseModal>
</template>
