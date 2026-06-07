<script setup lang="ts">
import { computed } from 'vue'

const props = withDefaults(defineProps<{
  modelValue: number
  min?: number
  max?: number
  step?: number
  ariaLabel?: string
}>(), { min: 0, max: 100, step: 1 })

const emit = defineEmits<{ 'update:modelValue': [value: number] }>()

// Porcentaje de relleno (0–100) para pintar la pista a dos colores.
const pct = computed(() => {
  const range = props.max - props.min
  if (range <= 0) return 0
  return Math.min(100, Math.max(0, ((props.modelValue - props.min) / range) * 100))
})
</script>

<template>
  <input
    type="range"
    class="tua-slider"
    :value="modelValue"
    :min="min"
    :max="max"
    :step="step"
    :aria-label="ariaLabel"
    :style="{ '--pct': pct + '%' }"
    @input="emit('update:modelValue', Number(($event.target as HTMLInputElement).value))"
  />
</template>

<style scoped>
/* Slider custom cross-browser: pista fina con relleno brand y thumb que
   aparece al hover/focus (patrón Spotify/Apple Music). */
.tua-slider {
  -webkit-appearance: none;
  appearance: none;
  width: 100%;
  height: 16px;            /* área táctil cómoda; la pista visible es más fina */
  background: transparent;
  cursor: pointer;
}

/* ── WebKit / Blink ─────────────────────────────────────────────── */
.tua-slider::-webkit-slider-runnable-track {
  height: 4px;
  border-radius: 9999px;
  background: linear-gradient(
    to right,
    var(--color-brand) var(--pct),
    var(--color-line) var(--pct)
  );
}
.tua-slider::-webkit-slider-thumb {
  -webkit-appearance: none;
  appearance: none;
  width: 12px;
  height: 12px;
  margin-top: -4px;        /* centra el thumb (12px) sobre la pista (4px) */
  border-radius: 9999px;
  background: #fff;
  opacity: 0;
  transform: scale(0.6);
  transition: opacity .15s ease, transform .15s ease;
}
.tua-slider:hover::-webkit-slider-thumb,
.tua-slider:focus-visible::-webkit-slider-thumb {
  opacity: 1;
  transform: scale(1);
}

/* ── Firefox ────────────────────────────────────────────────────── */
.tua-slider::-moz-range-track {
  height: 4px;
  border-radius: 9999px;
  background: var(--color-line);
}
.tua-slider::-moz-range-progress {
  height: 4px;
  border-radius: 9999px;
  background: var(--color-brand);
}
.tua-slider::-moz-range-thumb {
  width: 12px;
  height: 12px;
  border: none;
  border-radius: 9999px;
  background: #fff;
  opacity: 0;
  transition: opacity .15s ease;
}
.tua-slider:hover::-moz-range-thumb,
.tua-slider:focus-visible::-moz-range-thumb {
  opacity: 1;
}

.tua-slider:focus { outline: none; }
.tua-slider:focus-visible::-webkit-slider-runnable-track,
.tua-slider:focus-visible::-moz-range-track {
  outline: 2px solid color-mix(in oklch, var(--color-brand) 45%, transparent);
  outline-offset: 3px;
}
</style>
