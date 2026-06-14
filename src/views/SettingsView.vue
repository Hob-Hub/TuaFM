<script setup lang="ts">
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useSettingsStore } from '@/stores/settings.store'
import { useUiStore } from '@/stores/ui.store'
import { useFailedTracks } from '@/composables/useFailedTracks'
import { clearAllCaches } from '@/db/cache.maintenance'
import { SUPPORTED_LOCALES, LOCALE_LABELS, type AppLocale } from '@/i18n'
import BaseButton from '@/components/ui/BaseButton.vue'

const settings = useSettingsStore()
const ui = useUiStore()
const { t } = useI18n()
const { failures, clearFailures } = useFailedTracks()
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

function reasonLabel(reason: string): string {
  return reason === 'no-video' ? t('settings.problemsNoVideo') : t('settings.problemsError')
}

// Vuelca la lista a texto legible y la copia al portapapeles, para compartirla
// y poder arreglar esas canciones (sin tecnicismos: artista, título y motivo).
async function copyProblems(): Promise<void> {
  const lines = failures.value.map(f => {
    const times = f.count > 1 ? ` ·×${f.count}` : ''
    return `- ${f.artist} — ${f.title} (${reasonLabel(f.reason)}${times})`
  })
  const text = `TuaFM — ${t('settings.problems')} (${failures.value.length}):\n${lines.join('\n')}`
  try {
    await navigator.clipboard.writeText(text)
    ui.showToast(t('settings.problemsCopied'), 'success')
  } catch { /* portapapeles no disponible (sin permiso o contexto inseguro) */ }
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

    <!-- Pistas que no se pudieron reproducir: para revisarlas/compartirlas -->
    <section class="rounded-2xl bg-card border border-line p-5 mt-4">
      <h2 class="text-sm font-semibold text-white mb-1">{{ $t('settings.problems') }}</h2>
      <p class="text-xs text-muted mb-4">{{ $t('settings.problemsHint') }}</p>

      <p v-if="failures.length === 0" class="text-sm text-muted">{{ $t('settings.problemsEmpty') }}</p>

      <template v-else>
        <p class="text-xs text-muted mb-2">{{ $t('settings.problemsCount', failures.length) }}</p>
        <ul class="max-h-56 overflow-y-auto rounded-xl bg-surface-2 border border-line divide-y divide-line mb-4">
          <li v-for="f in failures" :key="f.cacheKey" class="flex items-center gap-2 px-3 py-2 text-sm">
            <span class="min-w-0 flex-1 truncate">
              <span class="text-white">{{ f.title }}</span>
              <span class="text-muted"> · {{ f.artist }}</span>
            </span>
            <span v-if="f.count > 1" class="shrink-0 text-[11px] text-muted tabular-nums">×{{ f.count }}</span>
            <span class="shrink-0 text-[11px] px-1.5 py-0.5 rounded bg-line/60 text-muted">{{ reasonLabel(f.reason) }}</span>
          </li>
        </ul>
        <div class="flex gap-2">
          <BaseButton variant="surface" @click="copyProblems">
            <svg viewBox="0 0 24 24" class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/></svg>
            {{ $t('settings.problemsCopy') }}
          </BaseButton>
          <BaseButton variant="surface" @click="clearFailures">
            {{ $t('settings.problemsClear') }}
          </BaseButton>
        </div>
      </template>
    </section>
  </div>
</template>
