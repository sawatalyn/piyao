<script setup>
import { computed, reactive, ref, watch } from 'vue';
import { useUiStore } from '../../stores/ui.js';

const props = defineProps({
  images: { type: Array, default: () => [] },
  modelValue: { type: Object, default: () => ({}) },
});
const emit = defineEmits(['update:modelValue']);

const ui = useUiStore();
const stage = ref(null);
const kind = ref('ellipse');
const color = ref('seal');
const activeMid = ref('');
const draft = ref(null);
const selected = ref(-1);

const COLORS = [
  { key: 'seal', name: '朱砂' },
  { key: 'gold', name: '藤黄' },
  { key: 'indigo', name: '花青' },
  { key: 'ink', name: '墨' },
];

watch(
  () => props.images,
  (list) => {
    if (!list.length) activeMid.value = '';
    else if (!list.some((item) => item.mid === activeMid.value)) activeMid.value = list[0].mid;
  },
  { immediate: true }
);

const currentUrl = computed(() => props.images.find((item) => item.mid === activeMid.value)?.url || '');
const list = computed(() => props.modelValue?.[activeMid.value] || []);

function commit(next) {
  if (!activeMid.value) return;
  emit('update:modelValue', { ...props.modelValue, [activeMid.value]: next });
}

function point(event) {
  const rect = stage.value.getBoundingClientRect();
  const clamp = (value, max) => Math.min(Math.max(value, 0), max);
  return {
    x: clamp((event.clientX - rect.left) / rect.width, 1),
    y: clamp((event.clientY - rect.top) / rect.height, 1),
  };
}

const origin = reactive({ x: 0, y: 0 });

function start(event) {
  if (!currentUrl.value) return;
  event.preventDefault();
  event.target.setPointerCapture?.(event.pointerId);
  const at = point(event);
  origin.x = at.x;
  origin.y = at.y;
  draft.value = { k: kind.value, c: color.value, x: at.x, y: at.y, w: 0.01, h: 0.01 };
}

function move(event) {
  if (!draft.value) return;
  const at = point(event);
  draft.value = {
    ...draft.value,
    x: Math.min(origin.x, at.x),
    y: Math.min(origin.y, at.y),
    w: Math.max(Math.abs(at.x - origin.x), 0.01),
    h: Math.max(Math.abs(at.y - origin.y), kind.value === 'line' ? 0.012 : 0.01),
  };
}

function end() {
  if (!draft.value) return;
  if (draft.value.w >= 0.02) {
    commit([...list.value, { ...draft.value, k: kind.value, c: color.value }]);
    selected.value = list.value.length;
  }
  draft.value = null;
}

function addCentered() {
  if (!activeMid.value) return;
  const shape = {
    k: kind.value,
    c: color.value,
    x: 0.3,
    y: kind.value === 'line' ? 0.5 : 0.35,
    w: 0.4,
    h: kind.value === 'line' ? 0.02 : 0.3,
  };
  commit([...list.value, shape]);
  selected.value = list.value.length;
  ui.notify('已在画面中央加入一笔，可用下方数值微调', 'commit');
}

function removeAt(index) {
  commit(list.value.filter((_, i) => i !== index));
  selected.value = -1;
}

function clearAll() {
  commit([]);
  selected.value = -1;
}

function patch(index, field, value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return;
  const next = list.value.map((item, i) =>
    i === index ? { ...item, [field]: Math.min(Math.max(number, field === 'w' || field === 'h' ? 0.01 : 0), 1) } : item
  );
  commit(next);
}

function shapeAttrs(shape) {
  if (shape.k === 'line') {
    return { x1: shape.x * 100, x2: (shape.x + shape.w) * 100, y1: (shape.y + shape.h / 2) * 100, y2: (shape.y + shape.h / 2) * 100 };
  }
  return {
    cx: (shape.x + shape.w / 2) * 100,
    cy: (shape.y + shape.h / 2) * 100,
    rx: Math.max(shape.w / 2, 0.01) * 100,
    ry: Math.max(shape.h / 2, 0.01) * 100,
  };
}
</script>

<template>
  <section class="annotator" aria-label="图片标注">
    <p v-if="!images.length" class="field-hint">
      本栏尚无图片。在上方富文本里「插入图片」后，即可在此为图片画圈或划线。
    </p>

    <template v-else>
      <div class="anno-head">
        <label class="paper-select-inline">
          <span class="micro-label">选择图片</span>
          <select v-model="activeMid" class="paper-select" aria-label="选择要标注的图片">
            <option v-for="image in images" :key="image.mid" :value="image.mid">
              {{ image.alt || image.mid }}
            </option>
          </select>
        </label>

        <fieldset class="inline-set">
          <legend class="micro-label">笔形</legend>
          <label class="paper-check">
            <input v-model="kind" type="radio" value="ellipse" name="anno-kind" />
            <span>画圈</span>
          </label>
          <label class="paper-check">
            <input v-model="kind" type="radio" value="line" name="anno-kind" />
            <span>划线</span>
          </label>
        </fieldset>

        <fieldset class="inline-set">
          <legend class="micro-label">笔色</legend>
          <label v-for="item in COLORS" :key="item.key" class="paper-check">
            <input v-model="color" type="radio" :value="item.key" name="anno-ink" />
            <span :class="`swatch swatch-${item.key}`"></span>
            <span>{{ item.name }}</span>
          </label>
        </fieldset>
      </div>

      <div class="anno-grid">
        <div
          ref="stage"
          class="anno-stage"
          @pointerdown="start"
          @pointermove="move"
          @pointerup="end"
          @pointercancel="end"
        >
          <img v-if="currentUrl" :src="currentUrl" :alt="`待标注图片：${activeMid}`" />
          <svg class="anno-svg" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
            <template v-for="(shape, index) in list" :key="`s${index}`">
              <line
                v-if="shape.k === 'line'"
                v-bind="shapeAttrs(shape)"
                :class="['ov', 'ov-line', `ov-${shape.c}`, { 'ov-picked': selected === index }]"
              />
              <ellipse
                v-else
                v-bind="shapeAttrs(shape)"
                :class="['ov', 'ov-circle', `ov-${shape.c}`, { 'ov-picked': selected === index }]"
              />
            </template>
            <ellipse
              v-if="draft && draft.k === 'ellipse'"
              v-bind="shapeAttrs(draft)"
              :class="['ov', 'ov-circle', `ov-${draft.c}`, 'ov-draft']"
            />
            <line
              v-else-if="draft"
              v-bind="shapeAttrs(draft)"
              :class="['ov', 'ov-line', `ov-${draft.c}`, 'ov-draft']"
            />
          </svg>
          <p class="stage-hint">在图上按住拖动即可画圈或划线</p>
        </div>

        <div class="anno-side">
          <div class="row">
            <button class="paper-btn btn-quiet" type="button" @click="addCentered">键盘友好：居中加一笔</button>
            <button class="paper-btn btn-quiet" type="button" :disabled="!list.length" @click="clearAll">
              清空本图
            </button>
          </div>

          <p v-if="!list.length" class="field-hint">本图暂无标注。</p>
          <ol v-else class="anno-list">
            <li v-for="(shape, index) in list" :key="`a${index}`">
              <div class="anno-item" :class="{ 'anno-item--on': selected === index }">
                <span class="anno-badge" :class="`ov-${shape.c}`">{{ shape.k === 'line' ? '线' : '圈' }}{{ index + 1 }}</span>
                <div class="anno-fine">
                  <label>
                    <span class="micro-label">X</span>
                    <input
                      class="paper-input fine"
                      type="number"
                      step="0.01"
                      min="0"
                      max="1"
                      :value="shape.x"
                      @change="patch(index, 'x', $event.target.value)"
                    />
                  </label>
                  <label>
                    <span class="micro-label">Y</span>
                    <input
                      class="paper-input fine"
                      type="number"
                      step="0.01"
                      min="0"
                      max="1"
                      :value="shape.y"
                      @change="patch(index, 'y', $event.target.value)"
                    />
                  </label>
                  <label>
                    <span class="micro-label">宽</span>
                    <input
                      class="paper-input fine"
                      type="number"
                      step="0.01"
                      min="0.01"
                      max="1"
                      :value="shape.w"
                      @change="patch(index, 'w', $event.target.value)"
                    />
                  </label>
                  <label>
                    <span class="micro-label">高</span>
                    <input
                      class="paper-input fine"
                      type="number"
                      step="0.01"
                      min="0.01"
                      max="1"
                      :value="shape.h"
                      @change="patch(index, 'h', $event.target.value)"
                    />
                  </label>
                </div>
                <button class="paper-btn btn-critical" type="button" @click="removeAt(index)">删除</button>
              </div>
            </li>
          </ol>
        </div>
      </div>
    </template>
  </section>
</template>

<style scoped>
.annotator {
  border: var(--grid-rule) solid var(--rule-firm);
  border-inline-start: 4px solid var(--anno-seal);
  padding: var(--space-4);
  background: var(--paper-leaf);
}
.anno-head {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  gap: var(--space-4);
  margin-block-end: var(--space-3);
}
.paper-select-inline {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
}
.anno-head .paper-select {
  width: auto;
  min-inline-size: 12rem;
}
.inline-set {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  border: var(--grid-rule) solid var(--rule-quiet);
  border-radius: var(--control-radius);
  padding: 0 var(--space-2);
  margin: 0;
  min-height: 34px;
}
.inline-set legend {
  padding-inline: 4px;
}
.anno-grid {
  display: grid;
  grid-template-columns: minmax(0, 1.5fr) minmax(0, 1fr);
  gap: var(--space-4);
}
.anno-stage {
  position: relative;
  touch-action: none;
  cursor: crosshair;
  border: var(--grid-rule) solid var(--rule-quiet);
  background: var(--terra-field);
  user-select: none;
}
.anno-stage img {
  display: block;
  inline-size: 100%;
}
.anno-svg {
  position: absolute;
  inset: 0;
  inline-size: 100%;
  block-size: 100%;
}
.ov {
  fill: none;
  vector-effect: non-scaling-stroke;
}
.ov-circle {
  stroke-width: 2.5;
}
.ov-line {
  stroke-width: 3.5;
  stroke-linecap: square;
}
.ov-seal {
  stroke: var(--anno-seal);
}
.ov-gold {
  stroke: var(--anno-gold);
}
.ov-indigo {
  stroke: var(--anno-indigo);
}
.ov-ink {
  stroke: var(--anno-ink);
}
.ov-picked {
  stroke-width: 5;
}
.ov-draft {
  stroke-dasharray: 4 3;
}
.stage-hint {
  position: absolute;
  inset-inline-start: var(--space-2);
  inset-block-end: var(--space-2);
  margin: 0;
  padding: 0 6px;
  font-size: var(--text-micro);
  color: var(--ink-mute);
  background: var(--paper-leaf);
  border: var(--grid-rule) solid var(--rule-quiet);
}
.anno-side {
  display: grid;
  align-content: start;
  gap: var(--space-3);
}
.anno-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: var(--space-2);
}
.anno-item {
  display: grid;
  gap: var(--space-2);
  padding: var(--space-2);
  border: var(--grid-rule) solid var(--rule-quiet);
  border-inline-start: 3px solid var(--rule-quiet);
  background: var(--paper-deep);
}
.anno-item--on {
  border-inline-start-color: var(--terra-signal);
}
.anno-badge {
  font-family: var(--font-display);
  font-size: var(--text-micro);
  color: var(--ink-soft);
}
.anno-fine {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: var(--space-1);
}
.anno-fine label {
  display: grid;
  gap: 1px;
}
.fine {
  min-height: 28px;
  padding: 0 4px;
  font-size: var(--text-micro);
  font-family: var(--font-mono);
}
.swatch {
  display: inline-block;
  inline-size: 12px;
  block-size: 12px;
  border: var(--grid-rule) solid var(--rule-firm);
}
.swatch-seal {
  background: var(--anno-seal);
}
.swatch-gold {
  background: var(--anno-gold);
}
.swatch-indigo {
  background: var(--anno-indigo);
}
.swatch-ink {
  background: var(--anno-ink);
}
@media (max-width: 860px) {
  .anno-grid {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
