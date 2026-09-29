<script setup>
import { computed, onMounted, ref } from 'vue';
import { useAuthStore } from '../stores/auth.js';
import { useResourceStore } from '../stores/resources.js';
import { describeError } from '../api/client.js';
import ConfirmDialog from '../components/paper/ConfirmDialog.vue';

const auth = useAuthStore();
const resources = useResourceStore();

const GROUPS = ['官方一手出处', '中文区查证载体', '访谈与翻译合集', '事实核对工具', '常见误传题材'];
const TRUSTS = ['高', '中', '待核实'];

const blank = () => ({ name: '', url: '', group: GROUPS[0], note: '', trust: '待核实', visible: true });
const draft = ref(blank());
const editingId = ref('');
const busy = ref(false);
const error = ref('');
const removal = ref(null);

/** 条目由人手工登记，链接渲染前再过一道协议白名单 */
const safeHref = (url) => (/^(https?:\/\/|\/)/i.test(String(url || '')) ? url : '');

const counts = computed(() => ({
  groups: resources.groups.length,
  items: resources.total,
}));

onMounted(() => {
  resources.load();
  if (auth.isAuthed) resources.loadAll().catch(() => undefined);
});

async function submit() {
  error.value = '';
  if (!draft.value.name.trim()) {
    error.value = '资源名称不可为空';
    return;
  }
  if (draft.value.url && !safeHref(draft.value.url)) {
    error.value = '链接仅支持 http(s) 或站内路径';
    return;
  }
  busy.value = true;
  try {
    if (editingId.value) await resources.update(editingId.value, draft.value);
    else await resources.create(draft.value);
    draft.value = blank();
    editingId.value = '';
    await resources.loadAll().catch(() => undefined);
  } catch (err) {
    error.value = describeError(err);
  } finally {
    busy.value = false;
  }
}

function edit(item) {
  editingId.value = item.id;
  draft.value = { name: item.name, url: item.url, group: item.group, note: item.note, trust: item.trust, visible: item.visible };
}

async function toggleVisible(item) {
  await resources.update(item.id, { ...item, visible: !item.visible });
}

async function confirmRemove() {
  await resources.remove(removal.value.id);
  removal.value = null;
  await resources.loadAll().catch(() => undefined);
}
</script>

<template>
  <div class="sheet-inner">
    <header class="sheet-head">
      <h1 class="sheet-title">辟谣常用资源库</h1>
      <div class="sheet-title-rule" aria-hidden="true"></div>
      <p class="sheet-lead">
        针对<b>无职转生</b>专题的查证载体清单：某句话该去哪个出处核对、该处能核实到什么、可信度几何。
        侧栏同步呈现，游客亦可读。条目只登记入口与用途，本站不镜像他人作品正文。
      </p>
      <p class="micro-label">
        {{ counts.groups }} 组 · {{ counts.items }} 条 · 更新于 <span class="tabular">{{ new Date().toISOString().slice(0, 10) }}</span>
      </p>
    </header>

    <section v-for="group in resources.groups" :key="group.group" class="group">
      <h2 class="group-head">
        <span>{{ group.group }}</span>
        <span class="micro-label">{{ group.items.length }} 条</span>
      </h2>
      <div class="res-list">
        <a
          v-for="item in group.items"
          :key="item.id"
          class="record-slip res-row"
          :href="safeHref(item.url)"
          target="_blank"
          rel="noopener noreferrer nofollow"
        >
          <span class="slip-body">
            <span class="slip-title">{{ item.name }}<span class="res-trust">〔{{ item.trust }}〕</span></span>
            <span class="res-url">{{ item.url || '（未登记链接）' }}</span>
            <span v-if="item.note" class="slip-tags"><span class="slip-tag">{{ item.note }}</span></span>
          </span>
        </a>
      </div>
    </section>

    <p v-if="!resources.loading && !resources.total" class="field-hint">尚无资源条目。</p>

    <section v-if="auth.isAuthed" class="pane">
      <div class="pane-head">
        <h2 class="pane-title">{{ editingId ? '修订条目' : '新增条目' }}</h2>
        <span class="micro-label">仅登录用户可编辑</span>
      </div>
      <div class="row two-col">
        <label class="field">
          <span class="field-label">资源名称<i aria-hidden="true">*</i></span>
          <input v-model.trim="draft.name" class="paper-input" type="text" maxlength="60" />
        </label>
        <label class="field">
          <span class="field-label">入口链接</span>
          <!-- 站内路径（如 /library）不是合法绝对 URL，故用 text + inputmode，由提交前的协议白名单兜底 -->
          <input v-model.trim="draft.url" class="paper-input" type="text" inputmode="url" maxlength="500" placeholder="https://… 或 /library" />
        </label>
      </div>
      <div class="row two-col">
        <label class="field">
          <span class="field-label">分组</span>
          <select v-model="draft.group" class="paper-select">
            <option v-for="item in GROUPS" :key="item" :value="item">{{ item }}</option>
          </select>
        </label>
        <label class="field">
          <span class="field-label">可信度</span>
          <select v-model="draft.trust" class="paper-select">
            <option v-for="item in TRUSTS" :key="item" :value="item">{{ item }}</option>
          </select>
        </label>
      </div>
      <label class="field">
        <span class="field-label">能核实到什么 / 使用提醒</span>
        <textarea v-model="draft.note" class="paper-input" rows="2" maxlength="200"></textarea>
      </label>
      <p v-if="error" class="field-error" role="alert">{{ error }}</p>
      <div class="row">
        <button class="paper-btn seal-press" type="button" :disabled="busy" @click="submit">
          {{ editingId ? '用印更新' : '用印登记' }}
        </button>
        <button v-if="editingId" class="paper-btn btn-quiet" type="button" @click="editingId = ''; draft = blank()">
          放弃修订
        </button>
      </div>

      <h3 class="micro-label">含隐藏条目全表（{{ resources.items.length }}）</h3>
      <div class="table-scroll">
        <table class="lic-table">
          <thead>
            <tr><th scope="col">名称</th><th scope="col">分组</th><th scope="col">可信度</th><th scope="col">暴露</th><th scope="col">操作</th></tr>
          </thead>
          <tbody>
            <tr v-for="item in resources.items" :key="item.id">
              <td>{{ item.name }}</td>
              <td>{{ item.group }}</td>
              <td>{{ item.trust }}</td>
              <td>{{ item.visible ? '显示' : '隐藏' }}</td>
              <td class="row-actions">
                <button class="paper-btn btn-quiet" type="button" @click="edit(item)">修订</button>
                <button class="paper-btn btn-quiet" type="button" @click="toggleVisible(item)">
                  {{ item.visible ? '隐藏' : '显示' }}
                </button>
                <button class="paper-btn btn-critical" type="button" @click="removal = item">移除</button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>

    <ConfirmDialog
      :open="Boolean(removal)"
      title="移除资源条目"
      :summary="removal ? `将从资源库移除「${removal.name}」，此操作不可撤销。` : ''"
      confirm-text="确认移除"
      @confirm="confirmRemove"
      @cancel="removal = null"
    />
  </div>
</template>

<style scoped>
.group {
  margin-block-end: var(--space-5);
}
.group-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: var(--space-3);
  font-size: var(--text-body);
  border-block-end: var(--grid-rule) solid var(--rule-firm);
  padding-block-end: var(--space-2);
  margin-block-end: var(--space-3);
}
.res-list {
  display: grid;
  gap: var(--space-2);
}
.res-row .slip-body {
  display: grid;
  gap: 2px;
}
.res-trust {
  font-size: var(--text-micro);
  color: var(--terra-signal-ink);
  margin-inline-start: var(--space-2);
}
.res-url {
  font-family: var(--font-mono);
  font-size: var(--text-micro);
  color: var(--ink-mute);
  overflow-wrap: anywhere;
}
.row-actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-1);
}
</style>
