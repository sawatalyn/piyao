<script setup>
import DOMPurify from 'dompurify';
import { nextTick, onMounted, ref, watch } from 'vue';

const props = defineProps({
  html: { type: String, default: '' },
  annotations: { type: Object, default: () => ({}) },
});

const root = ref(null);

// 服务端已净化，前端再净化一道：style 属性不在白名单内，杜绝样式与脚本注入
const CLEAN = {
  ALLOWED_TAGS: [
    'p', 'br', 'strong', 'b', 'em', 'i', 'u', 's', 'span', 'mark',
    'h3', 'h4', 'ul', 'ol', 'li', 'blockquote', 'pre', 'code',
    'figure', 'figcaption', 'img', 'a',
  ],
  ALLOWED_ATTR: ['href', 'target', 'rel', 'src', 'alt', 'class', 'data-mid', 'loading', 'decoding'],
  ALLOW_DATA_ATTR: false,
  ADD_ATTR: ['data-mid'],
  FORBID_TAGS: ['style', 'script', 'iframe', 'object', 'embed', 'form', 'input'],
  FORBID_ATTR: ['style', 'onerror', 'onload', 'onclick'],
};

function sanitize(html) {
  return DOMPurify.sanitize(String(html || ''), CLEAN);
}

const safeHtml = ref(sanitize(props.html));
watch(
  () => props.html,
  (value) => {
    safeHtml.value = sanitize(value);
  }
);

const SHAPE = 'http://www.w3.org/2000/svg';

function drawOverlays() {
  const rootEl = root.value;
  if (!rootEl) return;
  rootEl.querySelectorAll('svg.anno-overlay').forEach((node) => node.remove());
  for (const img of rootEl.querySelectorAll('img[data-mid]')) {
    const list = props.annotations?.[img.dataset.mid];
    if (!list?.length) continue;
    const host = img.closest('figure') || img.parentElement;
    if (!host) continue;
    host.classList.add('anno-host');
    const svg = document.createElementNS(SHAPE, 'svg');
    svg.setAttribute('class', 'anno-overlay');
    svg.setAttribute('viewBox', '0 0 100 100');
    svg.setAttribute('preserveAspectRatio', 'none');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('focusable', 'false');
    for (const anno of list) {
      const color = ['seal', 'gold', 'indigo', 'ink'].includes(anno.c) ? anno.c : 'seal';
      const shape = document.createElementNS(SHAPE, anno.k === 'line' ? 'line' : 'ellipse');
      if (anno.k === 'line') {
        shape.setAttribute('x1', String(anno.x * 100));
        shape.setAttribute('x2', String((anno.x + anno.w) * 100));
        shape.setAttribute('y1', String((anno.y + anno.h / 2) * 100));
        shape.setAttribute('y2', String((anno.y + anno.h / 2) * 100));
      } else {
        shape.setAttribute('cx', String((anno.x + anno.w / 2) * 100));
        shape.setAttribute('cy', String((anno.y + anno.h / 2) * 100));
        shape.setAttribute('rx', String(Math.max(anno.w / 2, 0.01) * 100));
        shape.setAttribute('ry', String(Math.max(anno.h / 2, 0.01) * 100));
      }
      shape.setAttribute('class', `ov ov-${anno.k === 'line' ? 'line' : 'circle'} ov-${color}`);
      svg.appendChild(shape);
    }
    host.appendChild(svg);
  }
}

onMounted(async () => {
  await nextTick();
  drawOverlays();
});

watch(
  () => [safeHtml.value, props.annotations],
  async () => {
    await nextTick();
    drawOverlays();
  },
  { deep: true }
);
</script>

<template>
  <div ref="root" class="rich" v-html="safeHtml" />
</template>

<style scoped>
.rich :deep(.anno-host) {
  position: relative;
}
.rich :deep(.anno-overlay) {
  position: absolute;
  inset: 0;
  inline-size: 100%;
  block-size: 100%;
  pointer-events: none;
}
.rich :deep(.ov) {
  fill: none;
  stroke-width: 3;
  vector-effect: non-scaling-stroke;
  stroke-linecap: square;
}
.rich :deep(.ov-circle) {
  stroke-width: 2.5;
}
.rich :deep(.ov-line) {
  stroke-width: 3.5;
}
.rich :deep(.ov-seal) {
  stroke: var(--anno-seal);
}
.rich :deep(.ov-gold) {
  stroke: var(--anno-gold);
}
.rich :deep(.ov-indigo) {
  stroke: var(--anno-indigo);
}
.rich :deep(.ov-ink) {
  stroke: var(--anno-ink);
}
</style>
