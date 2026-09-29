<script setup>
import { computed } from 'vue';
import { useWaterfall } from '../../composables/useWaterfall.js';

const props = defineProps({
  items: { type: Array, default: () => [] },
  minWidth: { type: Number, default: 300 },
  gap: { type: Number, default: 16 },
});

const list = computed(() => props.items);
const minWidthRef = computed(() => props.minWidth);

const { containerRef, positions, totalHeight, setItemRef, columnWidth } = useWaterfall(list, {
  minWidth: minWidthRef,
  gap: props.gap,
});

function styleFor(id) {
  const placed = positions.value.get(id);
  const width = `${(placed?.width ?? columnWidth.value ?? minWidthRef.value).toFixed(2)}px`;
  if (!placed) {
    return { transform: 'translate3d(0, -99999px, 0)', width };
  }
  return { transform: `translate3d(${placed.x.toFixed(1)}px, ${placed.y.toFixed(1)}px, 0)`, width };
}

/**
 * ref 回调必须按 id 稳定：内联箭头函数每次渲染都是新函数，
 * Vue 会先以 null 再以元素重调，与 layout 写状态相互触发形成死循环。
 */
const binders = new Map();
function binder(id) {
  if (!binders.has(id)) binders.set(id, (el) => setItemRef(id, el));
  return binders.get(id);
}
</script>

<template>
  <div
    ref="containerRef"
    class="waterfall"
    :aria-busy="false"
    :style="{ height: `${Math.round(totalHeight)}px` }"
  >
    <div
      v-for="(item, index) in items"
      :key="item.id"
      :ref="binder(item.id)"
      class="waterfall-item"
      :style="styleFor(item.id)"
    >
      <slot :item="item" :index="index" />
    </div>
  </div>
</template>

<style scoped>
.waterfall {
  position: relative;
  inline-size: 100%;
}
.waterfall-item {
  position: absolute;
  inset-block-start: 0;
  inset-inline-start: 0;
  will-change: transform;
}
</style>
