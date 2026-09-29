<script setup>
import { computed } from 'vue';
import { describeError } from '../../api/client.js';
import { useCatalogStore } from '../../stores/catalog.js';
import { useUiStore } from '../../stores/ui.js';

const props = defineProps({
  modelValue: { type: Array, default: () => [] },
  max: { type: Number, default: 20 },
});
const emit = defineEmits(['update:modelValue']);

const catalog = useCatalogStore();
const ui = useUiStore();

const rows = computed(() => props.modelValue || []);

let seq = 0;
const blank = () => ({
  id: `s${Date.now().toString(36)}${(seq += 1)}`,
  title: '',
  url: '',
  org: '',
  collectedAt: new Date().toISOString().slice(0, 10),
  note: '',
  mediaId: '',
  mediaUrl: '',
});

/**
 * 就地改对象再广播新数组：若只从 props 重建，同一 tick 内的第二次改动
 * 会基于尚未回流的旧 props 覆盖掉第一次改动。
 */
function patch(index, field, value) {
  const row = rows.value[index];
  if (!row) return;
  row[field] = value;
  emit('update:modelValue', [...rows.value]);
}

function addRow() {
  if (rows.value.length >= props.max) {
    ui.notify(`每条档案最多 ${props.max} 条材料源`, 'error');
    return;
  }
  emit('update:modelValue', [...rows.value, blank()]);
}

function removeRow(index) {
  const next = rows.value.filter((_, i) => i !== index);
  rows.value.splice(0, rows.value.length, ...next);
  emit('update:modelValue', [...next]);
}

async function uploadFor(index, event) {
  const file = event.target.files?.[0];
  event.target.value = '';
  if (!file) return;
  try {
    const record = await catalog.uploadImage(file);
    patch(index, 'mediaId', record.id);
    patch(index, 'mediaUrl', record.url);
    ui.notify('材料附图已入库', 'commit');
  } catch (err) {
    ui.notify(describeError(err), 'error');
  }
}

function dropImage(index) {
  patch(index, 'mediaId', '');
  patch(index, 'mediaUrl', '');
}
</script>

<template>
  <div class="source-rows">
    <p v-if="!rows.length" class="field-hint">尚无材料源。材料源须写明来源机构与采集时刻。</p>

    <ol class="rows">
      <li v-for="(row, index) in rows" :key="row.id || index" class="row-card">
        <div class="row-head">
          <span class="row-no tabular">材料 {{ String(index + 1).padStart(2, '0') }}</span>
          <button class="paper-btn btn-critical" type="button" @click="removeRow(index)">移除本条</button>
        </div>

        <div class="row-grid">
          <label class="field">
            <span class="field-label">材料标题</span>
            <input
              class="paper-input"
              type="text"
              :value="row.title"
              maxlength="120"
              placeholder="如：某某抽检结果通报"
              @input="patch(index, 'title', $event.target.value)"
            />
          </label>
          <label class="field">
            <span class="field-label">来源机构</span>
            <input
              class="paper-input"
              type="text"
              :value="row.org"
              maxlength="60"
              placeholder="谁提供的这条材料"
              @input="patch(index, 'org', $event.target.value)"
            />
          </label>
          <label class="field">
            <span class="field-label">超链接（http(s)）</span>
            <input
              class="paper-input"
              type="url"
              :value="row.url"
              placeholder="https://…"
              @input="patch(index, 'url', $event.target.value)"
            />
          </label>
          <label class="field">
            <span class="field-label">采集时刻</span>
            <input
              class="paper-input"
              type="date"
              :value="row.collectedAt"
              @input="patch(index, 'collectedAt', $event.target.value)"
            />
          </label>
          <label class="field span-2">
            <span class="field-label">结论指向（本材料支持哪一句辟谣）</span>
            <input
              class="paper-input"
              type="text"
              :value="row.note"
              maxlength="300"
              placeholder="如：证明第 2 点的限值口径"
              @input="patch(index, 'note', $event.target.value)"
            />
          </label>
        </div>

        <div class="row-image">
          <label class="upload">
            <input
              class="sr-only"
              type="file"
              accept="image/png,image/jpeg,image/gif,image/webp,image/avif"
              @change="uploadFor(index, $event)"
            />
            <span class="paper-btn btn-quiet">上传材料附图</span>
          </label>
          <template v-if="row.mediaUrl">
            <img class="thumb" :src="row.mediaUrl" :alt="`材料附图：${row.title || index + 1}`" />
            <button class="paper-btn btn-quiet" type="button" @click="dropImage(index)">去掉附图</button>
            <span class="micro-label">单图上限 5MB</span>
          </template>
          <span v-else class="field-hint">未附图片</span>
        </div>
      </li>
    </ol>

    <button class="paper-btn" type="button" :disabled="rows.length >= max" @click="addRow">
      ＋ 增加一条材料源（{{ rows.length }} / {{ max }}）
    </button>
  </div>
</template>

<style scoped>
.rows {
  list-style: none;
  margin: 0 0 var(--space-4);
  padding: 0;
  display: grid;
  gap: var(--space-3);
}
.row-card {
  border: var(--grid-rule) solid var(--rule-firm);
  border-inline-start: 4px solid var(--rule-quiet);
  background: var(--paper-leaf);
  padding: var(--space-3) var(--space-4);
}
.row-card:hover {
  border-inline-start-color: var(--anno-gold);
}
.row-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-block-end: var(--space-3);
  padding-block-end: var(--space-2);
  border-block-end: var(--grid-rule) solid var(--rule-quiet);
}
.row-no {
  font-family: var(--font-mono);
  font-size: var(--text-micro);
  letter-spacing: 0.12em;
  color: var(--ink-mute);
}
.row-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(13rem, 1fr));
  gap: 0 var(--space-4);
}
.span-2 {
  grid-column: 1 / -1;
}
.row-image {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  flex-wrap: wrap;
  margin-block-start: var(--space-2);
  padding-block-start: var(--space-2);
  border-block-start: var(--grid-rule) dashed var(--rule-quiet);
}
.upload {
  display: inline-flex;
  cursor: pointer;
}
.upload:focus-within .paper-btn {
  outline: var(--focus-ring) solid var(--terra-ink);
  outline-offset: 2px;
}
.thumb {
  inline-size: 64px;
  block-size: 64px;
  object-fit: cover;
  border: var(--grid-rule) solid var(--rule-firm);
}
</style>
