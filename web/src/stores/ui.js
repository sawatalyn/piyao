import { ref, watch } from 'vue';
import { defineStore } from 'pinia';

const KEY = 'bianwang.ui.v1';

function persisted() {
  try {
    return JSON.parse(localStorage.getItem(KEY) || '{}');
  } catch {
    return {};
  }
}

let toastSeq = 0;

/** 隐私浏览/禁用存储下 setItem 会抛，读侧已有兜底，写侧同样不能裸奔 */
function persist(value) {
  try {
    localStorage.setItem(KEY, JSON.stringify(value));
  } catch {
    /* 偏好仅本次会话有效 */
  }
}

export const useUiStore = defineStore('ui', () => {
  const saved = persisted();
  const marginOpen = ref(saved.marginOpen ?? true);
  const density = ref(saved.density ?? 300);
  const tone = ref(saved.tone ?? 'day');
  const toasts = ref([]);

  watch([marginOpen, density, tone], ([m, d, t]) => {
    persist({ marginOpen: m, density: d, tone: t });
  });

  watch(
    tone,
    (value) => {
      document.documentElement.dataset.tone = value === 'night' ? 'night' : 'day';
    },
    { immediate: true }
  );

  function notify(message, kind = 'info', sticky = false) {
    const id = `t${(toastSeq += 1)}`;
    toasts.value.push({ id, message, kind, sticky });
    if (!sticky) setTimeout(() => dismiss(id), 4200);
    return id;
  }

  function dismiss(id) {
    toasts.value = toasts.value.filter((toast) => toast.id !== id);
  }

  function toggleMargin() {
    marginOpen.value = !marginOpen.value;
  }

  return { marginOpen, density, tone, toasts, notify, dismiss, toggleMargin };
});
