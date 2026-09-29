<script setup>
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { RouterLink } from 'vue-router';
import Sortable from 'sortablejs';
import { describeError } from '../api/client.js';
import { useCatalogStore } from '../stores/catalog.js';
import { useUiStore } from '../stores/ui.js';

const catalog = useCatalogStore();
const ui = useUiStore();

const list = ref([]);
const dirty = ref(false);
const busy = ref(false);
const loading = ref(true);
const handle = ref(null);
let sortable = null;

async function load() {
  loading.value = true;
  try {
    await catalog.loadList({ reset: true });
    while (catalog.hasMore && !catalog.loading) {
      await catalog.loadList();
    }
    list.value = catalog.items.map((item) => ({
      id: item.id,
      title: item.title,
      pinned: item.pinned,
      tags: item.tags,
    }));
    dirty.value = false;
  } catch (err) {
    ui.notify(describeError(err), 'error');
  } finally {
    loading.value = false;
  }
}

function initSortable() {
  const el = handle.value;
  if (!el || typeof window === 'undefined') return;
  sortable?.destroy();
  sortable = new Sortable(el, {
    animation: 180,
    easing: 'cubic-bezier(0.32, 0.08, 0.24, 1)',
    handle: '.drag-handle',
    ghostClass: 'row--ghost',
    chosenClass: 'row--chosen',
    dragClass: 'row--dragging',
    onEnd: ({ oldIndex, newIndex }) => {
      if (oldIndex === newIndex || oldIndex == null || newIndex == null) return;
      const next = [...list.value];
      const [moved] = next.splice(oldIndex, 1);
      next.splice(newIndex, 0, moved);
      list.value = next;
      dirty.value = true;
    },
  });
}

function move(index, delta) {
  const target = index + delta;
  if (target < 0 || target >= list.value.length) return;
  const next = [...list.value];
  [next[index], next[target]] = [next[target], next[index]];
  list.value = next;
  dirty.value = true;
}

async function save() {
  busy.value = true;
  try {
    await catalog.saveOrder(list.value.map((item) => item.id));
    dirty.value = false;
    ui.notify('卷次顺序已归档，首页立即按此顺序呈现', 'commit');
  } catch (err) {
    ui.notify(describeError(err), 'error');
  } finally {
    busy.value = false;
  }
}

async function restore() {
  await load();
}

onMounted(async () => {
  await load();
  await nextTick();
  initSortable();
});

watch(() => list.value.length, async () => {
  await nextTick();
  initSortable();
});

onBeforeUnmount(() => sortable?.destroy());
</script>

<template>
  <div class="sheet-inner">
    <header class="sheet-head">
      <h1 class="sheet-title">卷次重排</h1>
      <div class="sheet-title-rule" aria-hidden="true"></div>
      <p class="sheet-lead">
        拖动卡片右侧的<b>界尺把手</b>即可调整首页顺序；也可用 ↑ ↓ 逐位移动（键盘可达）。
        置顶条目始终排在第一位，不参与排序。
      </p>
    </header>

    <div class="toolbar">
      <button class="paper-btn seal-press" type="button" :disabled="!dirty || busy" :aria-busy="busy ? 'true' : 'false'" @click="save">
        {{ busy ? '保存中…' : '用印保存顺序' }}
      </button>
      <button class="paper-btn btn-quiet" type="button" :disabled="!dirty || busy" @click="restore">
        放弃改动
      </button>
      <span class="toolbar-spacer" aria-hidden="true"></span>
      <span class="micro-label" aria-live="polite">
        {{ dirty ? '有未保存的顺序改动' : '顺序与线上一致' }} · 共 {{ list.length }} 条
      </span>
    </div>

    <p v-if="loading" class="field-hint" aria-busy="true">正在取卷次…</p>

    <ol v-else ref="handle" class="order-list">
      <li v-for="(item, index) in list" :key="item.id" class="order-row" :class="{ 'order-row--pinned': item.pinned }">
        <span class="order-no tabular">{{ String(index + 1).padStart(2, '0') }}</span>
        <div class="order-body">
          <RouterLink class="order-title" :to="{ name: 'post', params: { id: item.id } }">
            {{ item.title }}
          </RouterLink>
          <p class="order-tags">
            <span v-for="tag in item.tags.slice(0, 4)" :key="tag" class="slip-tag">{{ tag }}</span>
            <span v-if="item.pinned" class="pin-flag">置顶·首位</span>
          </p>
        </div>
        <div class="order-tools">
          <button class="paper-btn btn-quiet" type="button" :disabled="index === 0" :aria-label="`上移《${item.title}》`" @click="move(index, -1)">
            ↑
          </button>
          <button
            class="paper-btn btn-quiet"
            type="button"
            :disabled="index === list.length - 1"
            :aria-label="`下移《${item.title}》`"
            @click="move(index, 1)"
          >
            ↓
          </button>
          <span class="drag-handle" title="按住拖动" aria-hidden="true">
            <i></i><i></i><i></i>
          </span>
        </div>
      </li>
    </ol>

    <p v-if="!loading && !list.length" class="field-hint">尚无档案可排序。</p>
  </div>
</template>

<style scoped>
.toolbar-spacer {
  flex: 1;
}
.order-list {
  list-style: none;
  margin: var(--space-4) 0 0;
  padding: 0;
  display: grid;
  gap: var(--space-2);
}
.order-row {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: center;
  gap: var(--space-3);
  padding: var(--space-3) var(--space-4);
  background: var(--paper-leaf);
  border: var(--grid-rule) solid var(--rule-firm);
  border-inline-start: 4px solid var(--rule-quiet);
  border-radius: var(--control-radius);
}
.order-row--pinned {
  border-inline-start-color: var(--terra-signal);
  background: var(--paper-deep);
}
.row--ghost {
  opacity: 0.4;
  border-style: dashed;
}
.row--chosen {
  border-inline-start-color: var(--terra-signal);
}
.row--dragging {
  box-shadow: 0 6px 0 -2px var(--paper-shadow);
}
.order-no {
  font-family: var(--font-mono);
  font-size: var(--text-micro);
  color: var(--ink-mute);
}
.order-title {
  font-family: var(--font-display);
  font-size: var(--text-body);
  text-decoration: none;
  color: var(--terra-ink);
}
.order-title:hover {
  color: var(--terra-signal-ink);
}
.order-title:focus-visible {
  outline: var(--focus-ring) solid var(--terra-ink);
  outline-offset: 3px;
}
.order-tags {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-1);
  margin: 2px 0 0;
}
.pin-flag {
  font-size: var(--text-micro);
  letter-spacing: 0.12em;
  color: var(--terra-signal-ink);
}
.order-tools {
  display: flex;
  align-items: center;
  gap: var(--space-1);
}
.drag-handle {
  display: grid;
  gap: 3px;
  inline-size: 28px;
  block-size: 40px;
  place-content: center;
  cursor: grab;
  border: var(--grid-rule) solid var(--rule-quiet);
  border-radius: var(--control-radius);
  padding: var(--space-1);
}
.drag-handle i {
  display: block;
  block-size: 2px;
  background: var(--rule-firm);
}
.drag-handle:hover {
  border-color: var(--terra-ink);
}
.drag-handle:active {
  cursor: grabbing;
}
</style>
