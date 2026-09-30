<script setup>
import { computed, onMounted, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { api, describeError } from '../api/client.js';

const route = useRoute();
const postId = computed(() => String(route.params.id || ''));

const info = ref(null);
const loading = ref(true);
const error = ref('');
const fromId = ref('');
const toId = ref('');
const diff = ref(null);
const diffBusy = ref(false);
const ready = ref(false);

const items = computed(() => info.value?.items || []);
const newest = computed(() => items.value[items.value.length - 1] || null);
const versions = computed(() => [...items.value].reverse());

const clock = (iso) => (iso ? new Date(iso).toLocaleString('zh-CN', { hour12: false }) : '—');
const KIND = { create: '建档', update: '修订' };

async function runDiff() {
  if (!fromId.value || !toId.value) return;
  if (fromId.value === toId.value) {
    diff.value = null;
    error.value = '基线与对照选的是同一版，换一版再看差异。';
    return;
  }
  error.value = '';
  diffBusy.value = true;
  try {
    diff.value = await api.get(
      `/api/posts/${encodeURIComponent(postId.value)}/revisions/diff?from=${encodeURIComponent(fromId.value)}&to=${encodeURIComponent(toId.value)}`
    );
  } catch (err) {
    diff.value = null;
    error.value = describeError(err);
  } finally {
    diffBusy.value = false;
  }
}

async function loadAll() {
  loading.value = true;
  error.value = '';
  ready.value = false;
  try {
    info.value = await api.get(`/api/posts/${encodeURIComponent(postId.value)}/revisions`);
    fromId.value = info.value.pair.from;
    toId.value = info.value.pair.to;
    ready.value = true;
    await runDiff();
  } catch (err) {
    info.value = null;
    error.value = describeError(err);
  } finally {
    loading.value = false;
  }
}

onMounted(loadAll);
watch([fromId, toId], () => {
  if (ready.value) runDiff();
});
watch(postId, loadAll);
</script>

<template>
  <div class="sheet-inner">
    <header class="sheet-head">
      <h1 class="sheet-title">版本台账</h1>
      <div class="sheet-title-rule" aria-hidden="true"></div>
      <p class="sheet-lead">
        每一次建档与修订都留下<b>完整快照</b>：任选两版即可逐字段比对，正文按字与词标出增删。
        历史不随删档消失，但每档只保留最近 <b>{{ info?.keep || 30 }}</b> 版——这是核查台账，不是备份盘。
      </p>
      <p v-if="info" class="micro-label">
        <RouterLink class="back-link" :to="{ name: 'post', params: { id: postId } }">回到档案</RouterLink>
        · 现有 <span class="tabular">{{ items.length }}</span> 版 · 最新一版
        <span class="tabular">{{ clock(newest?.at) }}</span>
      </p>
      <p v-if="info && !info.post.exists" class="field-error" role="alert">
        《{{ info.post.title }}》已被移除，以下为其在档期间的历史版本。
      </p>
    </header>

    <p v-if="loading" class="field-hint" aria-busy="true">读取版本台账…</p>
    <p v-else-if="!info" class="field-error" role="alert">{{ error || '该档案没有版本记录' }}</p>

    <template v-else>
      <section class="pane" aria-label="版本清单">
        <div class="pane-head">
          <h2 class="pane-title">版本清单</h2>
          <span class="micro-label">{{ info.post.title }}</span>
        </div>
        <div class="table-scroll">
          <table class="lic-table">
            <thead>
              <tr>
                <th scope="col">版本</th><th scope="col">动作</th><th scope="col">时刻</th>
                <th scope="col">修订者</th><th scope="col">标题（当时）</th><th scope="col">正文字数</th><th scope="col">比对</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="row in versions" :key="row.id" :class="{ 'is-current': row.id === newest?.id }">
                <td class="tabular">v{{ row.version }}</td>
                <td>{{ KIND[row.kind] || row.kind }}</td>
                <td class="tabular">{{ clock(row.at) }}</td>
                <td>{{ row.by }}</td>
                <td>{{ row.title }}</td>
                <td class="tabular">谣 {{ row.charCount.rumor }} / 辟 {{ row.charCount.verdict }}</td>
                <td class="row-actions">
                  <button class="paper-btn btn-quiet" type="button" :disabled="!row.id" @click="fromId = row.id">设为基线</button>
                  <button class="paper-btn btn-quiet" type="button" :disabled="!row.id" @click="toId = row.id">设为对照</button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <p class="field-hint">「基线」是旧的一版，「对照」是新的那一版；两者相同时只提示不改写。</p>
      </section>

      <section class="pane" aria-label="两版比对">
        <div class="pane-head">
          <h2 class="pane-title">两版比对</h2>
          <span class="micro-label" :aria-busy="diffBusy ? 'true' : 'false'">
            {{ diffBusy ? '比对中' : diff ? `差异 ${diff.fields.length} 处` : '未选两版' }}
          </span>
        </div>
        <div class="row two-col">
          <label class="field">
            <span class="field-label">基线版本</span>
            <select v-model="fromId" class="paper-select">
              <option v-for="row in versions" :key="`f${row.id}`" :value="row.id">v{{ row.version }} · {{ clock(row.at) }} · {{ row.by }}</option>
            </select>
          </label>
          <label class="field">
            <span class="field-label">对照版本</span>
            <select v-model="toId" class="paper-select">
              <option v-for="row in versions" :key="`t${row.id}`" :value="row.id">v{{ row.version }} · {{ clock(row.at) }} · {{ row.by }}</option>
            </select>
          </label>
        </div>
        <p v-if="error" class="field-error" role="alert">{{ error }}</p>

        <template v-if="diff">
          <p class="micro-label">
            v{{ diff.from.version }}（{{ clock(diff.from.at) }} · {{ diff.from.by }}）→
            v{{ diff.to.version }}（{{ clock(diff.to.at) }} · {{ diff.to.by }}）
          </p>
          <p v-if="!diff.fields.length" class="field-hint">这两版在可比字段上完全一致。</p>
          <ul v-else class="diff-list">
            <li v-for="field in diff.fields" :key="field.key" class="diff-item">
              <h3 class="diff-label">{{ field.label }}</h3>
              <div v-if="field.segments" class="diff-body">
                <p class="diff-old">
                  <template v-for="(seg, index) in field.segments" :key="`o${index}`">
                    <del v-if="seg.op !== 'add'">{{ seg.text }}</del>
                  </template>
                </p>
                <p class="diff-new">
                  <template v-for="(seg, index) in field.segments" :key="`n${index}`">
                    <ins v-if="seg.op !== 'del'">{{ seg.text }}</ins>
                  </template>
                </p>
                <p v-if="field.coarse" class="micro-label">两版相差过大，这里按整段呈现（未做逐词标注）。</p>
              </div>
              <div v-else class="diff-body">
                <p class="diff-old">{{ field.before || '（空）' }}</p>
                <p class="diff-new">{{ field.after || '（空）' }}</p>
              </div>
            </li>
          </ul>
        </template>
      </section>
    </template>
  </div>
</template>

<style scoped>
.back-link {
  color: var(--terra-ink);
}
.row-actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-1);
}
.is-current td {
  color: var(--terra-ink);
}
.is-current .tabular {
  font-weight: 600;
}
.diff-list {
  list-style: none;
  margin: var(--space-3) 0 0;
  padding: 0;
  display: grid;
  gap: var(--space-3);
}
.diff-item {
  background: var(--paper-leaf);
  border: var(--grid-rule) solid var(--rule-quiet);
  border-inline-start: 3px solid var(--rule-firm);
  border-radius: var(--control-radius);
  padding: var(--space-3);
}
.diff-label {
  margin: 0 0 var(--space-2);
  font-family: var(--font-display);
  font-size: var(--text-small);
  letter-spacing: 0.04em;
  color: var(--ink-mute);
}
.diff-body {
  display: grid;
  gap: var(--space-2);
}
.diff-old,
.diff-new {
  margin: 0;
  white-space: pre-line;
  overflow-wrap: anywhere;
  font-size: var(--text-small);
  line-height: 1.7;
}
.diff-old {
  color: var(--ink-soft);
  border-inline-start: 2px solid var(--rule-quiet);
  padding-inline-start: var(--space-2);
}
.diff-new {
  border-inline-start: 2px solid var(--terra-signal-ink);
  padding-inline-start: var(--space-2);
}
.diff-old del {
  background: var(--paper-deep);
  color: var(--terra-ink);
  text-decoration-color: var(--rule-firm);
}
.diff-new ins {
  background: var(--paper-deep);
  text-decoration: none;
  border-block-end: 2px solid var(--terra-signal-ink);
}
</style>
