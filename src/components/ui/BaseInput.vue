<script setup lang="ts">
defineProps<{
  modelValue: string | number
  type?: string
  placeholder?: string
  min?: number
  max?: number
  label?: string
  ariaLabel?: string
}>()
const emit = defineEmits<{ 'update:modelValue': [value: string] }>()
</script>

<template>
  <label class="block">
    <span v-if="label" class="block text-xs font-medium text-muted mb-1.5">{{ label }}</span>
    <input
      :type="type ?? 'text'"
      :value="modelValue"
      :placeholder="placeholder"
      :min="min"
      :max="max"
      :aria-label="ariaLabel ?? label"
      class="w-full h-10 px-3 rounded-xl bg-surface-2 border border-line text-white/90
             placeholder:text-muted/60 focus:outline-none focus:border-brand/70
             focus:ring-2 focus:ring-brand/30 transition-colors"
      @input="emit('update:modelValue', ($event.target as HTMLInputElement).value)"
    />
  </label>
</template>
