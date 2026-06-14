<script setup lang="ts">
import { ref } from 'vue'
import { RouterLink, useRoute, useRouter } from 'vue-router'
import { usePlaylists } from '@/composables/usePlaylists'
import { useUiStore } from '@/stores/ui.store'

const route = useRoute()
const router = useRouter()
const ui = useUiStore()
const { playlists } = usePlaylists()

const searchTerm = ref('')
function submitSearch(): void {
  const q = searchTerm.value.trim()
  router.push({ name: 'search', query: q ? { q } : {} })
  ui.closeSidebar()
}

// label se localiza en plantilla con $t('nav.' + name).
const nav = [
  { name: 'home',     icon: 'M3 11l9-8 9 8M5 10v10h5v-6h4v6h5V10' },
  { name: 'radio',    icon: 'M4 8h16v11H4zM8 4l8 3M12 13a2 2 0 1 0 0 4 2 2 0 0 0 0-4z' },
  { name: 'recs',     icon: 'M12 2l2.4 7.4H22l-6 4.4 2.3 7.2L12 16.6 5.7 21l2.3-7.2-6-4.4h7.6z' },
  { name: 'history',  icon: 'M12 8v5l3 2M3 12a9 9 0 1 0 2-5.6M3 4v3h3' },
  { name: 'settings', icon: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 13a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-2.9 1.2V21a2 2 0 1 1-4 0v-.1A1.7 1.7 0 0 0 7 19.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1A1.7 1.7 0 0 0 3 13a2 2 0 1 1 0-4h.1A1.7 1.7 0 0 0 4.7 7l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1A1.7 1.7 0 0 0 11 3.1V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 2.9 1.2l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0 .3 1.9' }
]
</script>

<template>
  <aside class="h-full bg-surface flex flex-col gap-4 p-3 select-none">
    <!-- Logo -->
    <RouterLink :to="{ name: 'home' }" class="flex items-center gap-2 px-2 pt-2" @click="ui.closeSidebar()">
      <span class="grid place-items-center w-9 h-9 rounded-xl bg-brand/20 text-brand">
        <svg viewBox="0 0 24 24" class="w-5 h-5" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="2.5" fill="currentColor"/><path d="M12 4v3"/></svg>
      </span>
      <span class="font-display text-xl font-extrabold tracking-tight">Tua<span class="text-brand">FM</span></span>
    </RouterLink>

    <!-- Buscador -->
    <form class="relative" @submit.prevent="submitSearch">
      <svg viewBox="0 0 24 24" class="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted pointer-events-none" fill="none" stroke="currentColor" stroke-width="2">
        <circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/>
      </svg>
      <input
        v-model="searchTerm"
        type="search"
        :placeholder="$t('sidebar.searchPlaceholder')"
        :aria-label="$t('sidebar.searchAria')"
        class="w-full h-9 pl-9 pr-3 rounded-xl bg-surface-2 border border-line text-sm text-white/90
               placeholder:text-muted/60 focus:outline-none focus:border-brand/70 focus:ring-2 focus:ring-brand/30 transition-colors"
      />
    </form>

    <!-- Navegación principal -->
    <nav class="flex flex-col gap-1">
      <RouterLink
        v-for="item in nav" :key="item.name"
        :to="{ name: item.name }"
        class="flex items-center gap-3 px-3 h-10 rounded-xl text-sm transition-colors"
        :class="route.name === item.name ? 'bg-card text-white' : 'text-muted hover:text-white hover:bg-card/60'"
        @click="ui.closeSidebar()"
      >
        <svg viewBox="0 0 24 24" class="w-5 h-5 shrink-0" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path :d="item.icon"/></svg>
        {{ $t('nav.' + item.name) }}
      </RouterLink>
    </nav>

    <!-- Playlists -->
    <div class="flex items-center justify-between px-3 mt-2">
      <span class="text-xs font-semibold uppercase tracking-wider text-muted">{{ $t('sidebar.yourPlaylists') }}</span>
      <button class="p-1 rounded-lg text-muted hover:text-white hover:bg-card" :aria-label="$t('sidebar.newPlaylist')" @click="ui.openCreatePlaylist()">
        <svg viewBox="0 0 24 24" class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 5v14M5 12h14"/></svg>
      </button>
    </div>

    <div class="flex-1 overflow-y-auto -mx-1 px-1">
      <ul class="flex flex-col gap-0.5">
        <li v-for="pl in playlists" :key="pl.id">
          <RouterLink
            :to="{ name: 'playlist', params: { id: pl.id } }"
            class="flex items-center gap-2 px-3 h-9 rounded-lg text-sm truncate transition-colors"
            :class="route.params.id === pl.id ? 'bg-card text-white' : 'text-muted hover:text-white hover:bg-card/60'"
            @click="ui.closeSidebar()"
          >
            <span class="truncate">{{ pl.name }}</span>
            <span class="ml-auto text-[10px] text-muted/70 tabular-nums">{{ pl.trackIds.length }}</span>
          </RouterLink>
        </li>
        <li v-if="playlists.length === 0" class="px-3 py-4 text-xs text-muted/80 leading-relaxed">
          {{ $t('sidebar.empty') }}
        </li>
      </ul>
    </div>
  </aside>
</template>
