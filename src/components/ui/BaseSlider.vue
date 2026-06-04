<script setup lang="ts">
defineProps<{
  modelValue: number
  min?: number
  max?: number
  step?: number
  ariaLabel?: string
}>()
const emit = defineEmits<{ 'update:modelValue': [value: number] }>()
</script>

<template>
  <input
    type="range"
    :value="modelValue"
    :min="min ?? 0"
    :max="max ?? 100"
    :step="step ?? 1"
    :aria-label="ariaLabel"
    class="w-full cursor-pointer accent-brand"
    @input="emit('update:modelValue', Number(($event.target as HTMLInputElement).value))"
  />
</template>
