<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import Sortable from 'sortablejs';
import { useMenuStore } from '../stores/menu.js';
import { useAuthStore } from '../stores/auth.js';
import { useUiStore } from '../stores/ui.js';
import { describeError } from '../api/client.js';

const menu = useMenuStore();
const auth = useAuthStore();
const ui = useUiStore();

const rows = ref([]);
const dirty = ref(false);
const handle = ref(null);
let sortable = null;

watch(
  () => menu.editorRows,
  (value) => {
    if (!dirty.value && value.length) rows.value = value.map((row) => ({ ...row }));
  },
  { immediate: true }
);

function initSortable() {
  const el = handle.value;
  if (!el) return;
  sortable?.destroy();
  sortable = new Sortable(el, {
    animation: 180,
    handle: '.drag-handle',
    ghostClass: 'mrow--ghost',
    onEnd: ({ oldIndex, newIndex }) => {
      if (oldIndex == null || newIndex == null || oldIndex === newIndex) return;
      const next = [...rows.value];
      const [moved] = next.splice(oldIndex, 1);
      next.splice(newIndex, 0, moved);
      rows.value = next.map((row, order) => ({ ...row, order }));
      dirty.value = true;
    },
  });
}

const visibleCount = computed(() => rows.value.filter((row) => row.visible).length);
const preview = computed(() => rows.value.filter((row) => row.visible));

function toggle(row, value) {
  row.visible = value;
  dirty.value = true;
}

function rename(row, value) {
  row.label = String(value).slice(0, 24);
  dirty.value = true;
}

async function save() {
  const ok = await menu.save(
    rows.value.map((row, order) => ({
      moduleId: row.moduleId,
      visible: row.visible,
      label: row.label,
      order,
    }))
  );
  if (ok) dirty.value = false;
}

async function restore() {
  await menu.load();
  rows.value = menu.editorRows.map((row) => ({ ...row }));
  dirty.value = false;
}

async function toggleAll(value) {
  rows.value = rows.value.map((row) => ({ ...row, visible: value }));
  dirty.value = true;
}

onMounted(async () => {
  await nextTick();
  initSortable();
});
watch(() => rows.value.length, async () => {
  await nextTick();
  initSortable();
});
onBeforeUnmount(() => sortable?.destroy());

const error = ref('');
async function guardedSave() {
  if (!visibleCount.value) {
    error.value = '至少保留一个菜单项，否则卷首将无导航可用。';
    ui.notify(error.value, 'error');
    return;
  }
  error.value = '';
  await save();
}
</script>

<template>
  <div class="sheet-inner">
    <header class="sheet-head">
      <h1 class="sheet-title">菜单编辑</h1>
      <div class="sheet-title-rule" aria-hidden="true"></div>
      <p class="sheet-lead">
        勾选即暴露为卷首索引与批注栏入口，取消即隐藏；拖动界尺把手可调整次序。
        功能本体由模块注册表定义，这里只改可见性与顺序。
      </p>
    </header>

    <div class="toolbar">
      <button class="paper-btn seal-press" type="button" :disabled="!dirty" :aria-busy="menu.saving ? 'true' : 'false'" @click="guardedSave">
        {{ menu.saving ? '保存中…' : '用印保存菜单' }}
      </button>
      <button class="paper-btn btn-quiet" type="button" :disabled="!dirty" @click="restore">放弃改动</button>
      <button class="paper-btn btn-quiet" type="button" @click="toggleAll(true)">全部显示</button>
      <button class="paper-btn btn-quiet" type="button" @click="toggleAll(false)">全部隐藏</button>
      <span style="flex: 1" aria-hidden="true"></span>
      <span class="micro-label" aria-live="polite">暴露 {{ visibleCount }} / {{ rows.length }} 项</span>
    </div>

    <p v-if="error" class="field-error" role="alert">{{ error }}</p>

    <section class="pane">
      <h2>卷首索引预览</h2>
      <p class="micro-label">{{ auth.isAuthed ? '以下按已登录身份显示' : '以下按游客身份显示（需登录项带标记）' }}</p>
      <ol class="preview">
        <li v-for="row in preview" :key="`p${row.moduleId}`" :class="{ 'preview--locked': row.requiresAuth && !auth.isAuthed }">
          {{ row.label }}<span v-if="row.requiresAuth && !auth.isAuthed" class="micro-label">登录</span>
        </li>
        <li v-if="!preview.length" class="field-hint">全部隐藏后卷首将没有导航。</li>
      </ol>
    </section>

    <ol ref="handle" class="menu-list">
      <li v-for="row in rows" :key="row.moduleId" class="mrow">
        <span class="drag-handle" aria-hidden="true"><i></i><i></i><i></i></span>
        <label class="paper-check">
          <input type="checkbox" :checked="row.visible" @change="toggle(row, $event.target.checked)" />
          <span class="sr-only">暴露 {{ row.label }} 为菜单</span>
        </label>
        <div class="mrow-main">
          <label class="mrow-name">
            <span class="micro-label">显示名</span>
            <input
              class="paper-input"
              type="text"
              maxlength="24"
              :value="row.label"
              :aria-label="`${row.moduleId} 的菜单显示名`"
              @input="rename(row, $event.target.value)"
            />
          </label>
          <p class="mrow-meta">
            <code>{{ row.route }}</code>
            <span v-if="row.requiresAuth" class="badge-lock">需登录</span>
            <span class="badge-mod">{{ row.moduleId }}</span>
          </p>
          <p class="mrow-sum">{{ row.summary }}</p>
        </div>
      </li>
    </ol>
  </div>
</template>

<style scoped>
.preview {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
  list-style: none;
  margin: var(--space-2) 0 0;
  padding: 0;
}
.preview li {
  display: inline-flex;
  gap: var(--space-1);
  padding: var(--space-1) var(--space-3);
  background: var(--paper-deep);
  border: var(--grid-rule) solid var(--rule-quiet);
  border-inline-start: 3px solid var(--terra-signal);
  font-family: var(--font-display);
  font-size: var(--text-small);
}
.preview--locked {
  border-inline-start-color: var(--rule-firm);
  color: var(--ink-mute);
}
.menu-list {
  list-style: none;
  margin: var(--space-4) 0 0;
  padding: 0;
  display: grid;
  gap: var(--space-2);
}
.mrow {
  display: grid;
  grid-template-columns: auto auto minmax(0, 1fr);
  gap: var(--space-3);
  align-items: start;
  padding: var(--space-3) var(--space-4);
  background: var(--paper-leaf);
  border: var(--grid-rule) solid var(--rule-firm);
  border-inline-start: 4px solid var(--rule-quiet);
  border-radius: var(--control-radius);
}
.mrow:hover {
  border-inline-start-color: var(--anno-gold);
}
.mrow--ghost {
  opacity: 0.4;
}
.mrow-main {
  min-width: 0;
}
.mrow-name {
  display: grid;
  gap: 2px;
  margin-block-end: var(--space-2);
}
.mrow-name .paper-input {
  max-inline-size: 16rem;
  min-height: 34px;
}
.mrow-meta {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-2);
  margin: 0 0 var(--space-1);
  font-size: var(--text-micro);
}
.mrow-meta code {
  font-family: var(--font-mono);
  color: var(--ink-mute);
}
.mrow-sum {
  margin: 0;
  font-size: var(--text-small);
  color: var(--ink-mute);
}
.badge-lock,
.badge-mod {
  padding: 0 6px;
  border: var(--grid-rule) solid currentColor;
  border-radius: var(--control-radius);
}
.badge-lock {
  color: var(--terra-signal-ink);
}
.badge-mod {
  color: var(--rule-firm);
  font-family: var(--font-mono);
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
</style>
