<script setup lang="ts">
import { useSettingsStore } from '@/stores/settings.store'
import { SUPPORTED_LOCALES, LOCALE_LABELS, type AppLocale } from '@/i18n'

const settings = useSettingsStore()

function select(locale: AppLocale): void {
  settings.setLocale(locale)
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
  </div>
</template>
