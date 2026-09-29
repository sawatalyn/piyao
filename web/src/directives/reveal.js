/**
 * v-reveal：单例 IntersectionObserver 复用（lozad 每实例新建 observer，这里改为共享）。
 * 采纳其三个细节：命中即 unobserve、data-revealed 幂等标记、无 IO 支持时立即呈现。
 */
let observer = null;
const registry = new WeakMap();

function supported() {
  return typeof IntersectionObserver !== 'undefined';
}

function reveal(el) {
  if (el.dataset.revealed === 'true') return;
  el.dataset.revealed = 'true';
  observer?.unobserve(el);
  registry.delete(el);
}

function ensureObserver(rootMargin) {
  if (!supported()) return null;
  if (observer) return observer;
  observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) reveal(entry.target);
      }
    },
    { root: null, rootMargin, threshold: 0.01 }
  );
  return observer;
}

export const vReveal = {
  mounted(el, binding) {
    if (!supported()) {
      reveal(el);
      return;
    }
    el.dataset.revealed = 'false';
    const instance = ensureObserver(binding.value?.rootMargin || '120px 0px');
    registry.set(el, instance);
    instance.observe(el);
  },
  updated(el) {
    // 已揭示的元素不再回退
    if (el.dataset.revealed === 'true' && registry.has(el)) {
      registry.get(el)?.unobserve(el);
      registry.delete(el);
    }
  },
  unmounted(el) {
    registry.get(el)?.unobserve(el);
    registry.delete(el);
  },
};

export function disconnectReveal() {
  observer?.disconnect();
  observer = null;
}

/** 图片解码完成前保持占位，避免瀑布流跳变 */
export function whenImageReady(img) {
  return new Promise((resolve) => {
    if (!img) return resolve(false);
    if (img.complete && img.naturalWidth > 0) return resolve(true);
    img.addEventListener('load', () => resolve(true), { once: true });
    img.addEventListener('error', () => resolve(false), { once: true });
  });
}
