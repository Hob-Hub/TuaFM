<script setup lang="ts">
withDefaults(defineProps<{
  variant?: 'brand' | 'ghost' | 'surface' | 'danger'
  size?:    'sm' | 'md' | 'lg' | 'icon'
  disabled?: boolean
  type?:    'button' | 'submit'
}>(), {
  variant: 'surface',
  size: 'md',
  disabled: false,
  type: 'button'
})

const variants: Record<string, string> = {
  brand:   'bg-brand text-white hover:bg-brand-soft',
  ghost:   'bg-transparent text-white/80 hover:bg-white/10',
  surface: 'bg-card text-white/90 hover:bg-card-hover border border-line',
  danger:  'bg-transparent text-red-400 hover:bg-red-500/10'
}
const sizes: Record<string, string> = {
  sm:   'h-8 px-3 text-sm rounded-lg gap-1.5',
  md:   'h-10 px-4 text-sm rounded-xl gap-2',
  lg:   'h-12 px-6 text-base rounded-xl gap-2',
  icon: 'h-10 w-10 rounded-xl justify-center'
}
</script>

<template>
  <button
    :type="type"
    :disabled="disabled"
    class="inline-flex items-center font-medium transition-colors select-none
           disabled:opacity-40 disabled:pointer-events-none focus:outline-none
           focus-visible:ring-2 focus-visible:ring-brand/60"
    :class="[variants[variant], sizes[size]]"
  >
    <slot />
  </button>
</template>
