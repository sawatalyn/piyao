import { onBeforeUnmount, onMounted, ref, watch } from 'vue';

/**
 * 保序瀑布流：DOM 顺序恒等于输入顺序（置顶与自定义顺序因此不会被重排），
 * 视觉落位用"最短列优先"，仅决定坐标，不改变节点次序。
 */
export function useWaterfall(items, options = {}) {
  const minWidth = options.minWidth ?? ref(300);
  const gap = options.gap ?? 16;

  const containerRef = ref(null);
  const positions = ref(new Map());
  const totalHeight = ref(0);
  const columnCount = ref(1);
  const columnWidth = ref(0);

  const heights = new Map();
  const elements = new Map();
  let width = 0;
  let frame = 0;
  let resizeObserver = null;
  let containerObserver = null;

  function setItemRef(id, el) {
    if (!el) {
      const gone = elements.get(id);
      if (gone) resizeObserver?.unobserve(gone);
      elements.delete(id);
      heights.delete(id);
      schedule();
      return;
    }
    if (elements.get(id) === el) return;
    const previous = elements.get(id);
    if (previous) resizeObserver?.unobserve(previous);
    elements.set(id, el);
    heights.set(id, el.offsetHeight || 0);
    resizeObserver?.observe(el);
    schedule();
  }

  /** 坐标未变则不写回，避免"写状态 → 重渲染 → 再写"的自激环 */
  function signature(map) {
    let out = '';
    for (const [id, value] of map) {
      out += `${id}:${value.x.toFixed(1)},${value.y.toFixed(1)},${value.width.toFixed(1)}|`;
    }
    return out;
  }
  let lastSignature = '';

  function layout() {
    const container = containerRef.value;
    if (!container) return;
    width = container.clientWidth || width;
    if (!width) return;

    const cols = Math.max(1, Math.floor((width + gap) / (minWidth.value + gap)));
    const colWidth = (width - gap * (cols - 1)) / cols;
    const colHeights = new Array(cols).fill(0);
    const next = new Map();

    for (const item of items.value) {
      const el = elements.get(item.id);
      if (el) heights.set(item.id, el.offsetHeight || heights.get(item.id) || 0);
      const height = heights.get(item.id) || (el ? 0 : 220);
      let column = 0;
      for (let i = 1; i < cols; i += 1) if (colHeights[i] < colHeights[column]) column = i;
      next.set(item.id, {
        x: column * (colWidth + gap),
        y: colHeights[column],
        width: colWidth,
      });
      colHeights[column] += height + gap;
    }

    const nextSignature = signature(next);
    if (nextSignature === lastSignature && positions.value.size === next.size) return;
    lastSignature = nextSignature;

    positions.value = next;
    columnCount.value = cols;
    columnWidth.value = colWidth;
    totalHeight.value = Math.max(0, ...colHeights) - (colHeights.some((h) => h > 0) ? gap : 0);
  }

  function schedule() {
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      layout();
    });
  }

  onMounted(() => {
    if (typeof ResizeObserver !== 'undefined') {
      resizeObserver = new ResizeObserver(schedule);
      for (const el of elements.values()) resizeObserver.observe(el);
      if (containerRef.value) {
        containerObserver = new ResizeObserver(schedule);
        containerObserver.observe(containerRef.value);
      }
    } else {
      window.addEventListener('resize', schedule);
    }
    layout();
  });

  onBeforeUnmount(() => {
    if (frame) cancelAnimationFrame(frame);
    resizeObserver?.disconnect();
    containerObserver?.disconnect();
    window.removeEventListener('resize', schedule);
  });

  watch(items, schedule, { deep: true });
  watch(minWidth, schedule);

  return { containerRef, positions, totalHeight, columnCount, columnWidth, setItemRef, relayout: schedule };
}
