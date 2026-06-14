<script setup lang="ts">
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useSettingsStore } from '@/stores/settings.store'
import { useUiStore } from '@/stores/ui.store'
import { clearAllCaches } from '@/db/cache.maintenance'
import { SUPPORTED_LOCALES, LOCALE_LABELS, type AppLocale } from '@/i18n'
import BaseButton from '@/components/ui/BaseButton.vue'

const settings = useSettingsStore()
const ui = useUiStore()
const { t } = useI18n()
const clearing = ref(false)

function select(locale: AppLocale): void {
  settings.setLocale(locale)
}

async function clearCache(): Promise<void> {
  if (clearing.value) return
  clearing.value = true
  try {
    const n = await clearAllCaches()
    ui.showToast(t('settings.cacheCleared', n), 'success')
  } catch {
    ui.showToast(t('settings.cacheClearError'), 'error')
  } finally {
    clearing.value = false
  }
}
</script>

<template>
  <div class="p-5 sm:p-8 max-w-2xl mx-auto">
    <header class="mb-6">
      <h1 class="font-display text-2xl sm:text-3xl font-extrabold">{{ $t('settings.title') }}</h1>
      <p class="text-muted text-sm mt-1">{{ $t('settings.subtitle') }}</p>
    </header>

    <section class="rounded-2xl bg-card border border-line p-5">
      <h2 class="text-sm font-semibold text-white mb-1">{{ $t('settings.language') }}</h2>
      <p class="text-xs text-muted mb-4">{{ $t('settings.languageHint') }}</p>

      <div class="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <button
          v-for="locale in SUPPORTED_LOCALES" :key="locale"
          class="flex items-center justify-center gap-2 px-3 h-11 rounded-xl border text-sm font-medium transition-colors"
          :class="settings.locale === locale
            ? 'border-brand bg-brand/15 text-white'
            : 'border-line bg-surface-2 text-muted hover:text-white'"
          :aria-pressed="settings.locale === locale"
          @click="select(locale)"
        >
          {{ LOCALE_LABELS[locale] }}
        </button>
      </div>
    </section>

    <section class="rounded-2xl bg-card border border-line p-5 mt-4">
      <h2 class="text-sm font-semibold text-white mb-1">{{ $t('settings.data') }}</h2>
      <p class="text-xs text-muted mb-4">{{ $t('settings.dataHint') }}</p>
      <BaseButton variant="surface" :disabled="clearing" @click="clearCache">
        <svg viewBox="0 0 24 24" class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/></svg>
        {{ clearing ? $t('common.loading') : $t('settings.clearCache') }}
      </BaseButton>
    </section>
  </div>
</template>
