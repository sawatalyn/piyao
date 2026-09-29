<script setup>
import { useUiStore } from '../../stores/ui.js';

const ui = useUiStore();
</script>

<template>
  <div class="toast-stack" role="status" aria-live="polite" aria-atomic="false">
    <TransitionGroup name="toast">
      <div v-for="toast in ui.toasts" :key="toast.id" class="toast" :data-kind="toast.kind">
        <span class="toast-mark" aria-hidden="true">{{ toast.kind === 'error' ? '△' : toast.kind === 'commit' ? '印' : '·' }}</span>
        <span>{{ toast.message }}</span>
        <button type="button" @click="ui.dismiss(toast.id)">关闭</button>
      </div>
    </TransitionGroup>
  </div>
</template>

<style scoped>
.toast-mark {
  font-family: var(--font-display);
  color: var(--terra-signal);
  font-weight: 700;
}
.toast[data-kind='error'] .toast-mark {
  color: var(--terra-critical);
}

@media (prefers-reduced-motion: no-preference) {
  .toast-enter-active,
  .toast-leave-active {
    transition: opacity 240ms var(--ease-archive), translate 240ms var(--ease-archive);
  }
  .toast-enter-from,
  .toast-leave-to {
    opacity: 0;
    translate: 12px 0;
  }
  .toast-leave-active {
    position: absolute;
    inline-size: 100%;
  }
}
@media (prefers-reduced-motion: reduce) {
  .toast-enter-active,
  .toast-leave-active {
    transition: none;
  }
}
</style>
