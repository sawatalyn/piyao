<script setup>
import { computed, onBeforeUnmount, ref, watch } from 'vue';

const props = defineProps({
  open: { type: Boolean, default: false },
  title: { type: String, default: '请确认' },
  summary: { type: String, default: '' },
  consequence: { type: String, default: '' },
  confirmText: { type: String, default: '确认用印' },
  danger: { type: Boolean, default: false },
  busy: { type: Boolean, default: false },
});

const emit = defineEmits(['confirm', 'cancel']);
const dialog = ref(null);

const isOpen = computed(() => props.open);

watch(isOpen, (value) => {
  const el = dialog.value;
  if (!el) return;
  if (value && !el.open) el.showModal();
  if (!value && el.open) el.close();
});

function onClose() {
  emit('cancel');
}
</script>

<template>
  <dialog ref="dialog" class="paper-dialog" aria-modal="true" @close="onClose">
    <header>
      <h2 class="dialog-title">{{ title }}</h2>
    </header>
    <div class="dialog-body">
      <p v-if="summary" class="dialog-summary">{{ summary }}</p>
      <p v-if="consequence" class="dialog-consequence">
        <span class="micro-label">后果</span>
        {{ consequence }}
      </p>
      <slot />
    </div>
    <footer>
      <button class="paper-btn btn-quiet" type="button" :disabled="busy" @click="emit('cancel')">
        取消（保留原状）
      </button>
      <button
        class="paper-btn"
        :class="danger ? 'btn-critical' : 'seal-press'"
        type="button"
        :aria-busy="busy ? 'true' : 'false'"
        :disabled="busy"
        @click="emit('confirm')"
      >
        {{ busy ? '处理中…' : confirmText }}
      </button>
    </footer>
  </dialog>
</template>

<style scoped>
.dialog-title {
  font-size: var(--text-lead);
  letter-spacing: 0.06em;
}
.dialog-summary {
  margin: 0 0 var(--space-3);
  font-family: var(--font-display);
}
.dialog-consequence {
  margin: 0;
  padding: var(--space-3);
  background: var(--paper-deep);
  border-inline-start: 3px solid var(--anno-gold);
  font-size: var(--text-small);
  color: var(--ink-soft);
}
.dialog-consequence .micro-label {
  display: block;
  margin-block-end: 2px;
}
</style>
