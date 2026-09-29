<script setup>
import { onMounted, reactive, ref } from 'vue';
import ConfirmDialog from '../components/paper/ConfirmDialog.vue';
import { api, describeError } from '../api/client.js';
import { useAuthStore } from '../stores/auth.js';
import { useUiStore } from '../stores/ui.js';

const auth = useAuthStore();
const ui = useUiStore();

const items = ref([]);
const storage = ref('plaintext-csv');
const warning = ref('');
const defaultInUse = ref(false);
const loading = ref(true);
const busy = ref(false);
const confirmTarget = ref('');

const draft = reactive({ username: '', password: '', role: 'editor', displayName: '' });
const errors = reactive({ username: '', password: '' });

async function load() {
  loading.value = true;
  try {
    const data = await api.get('/api/users');
    items.value = data.items;
    storage.value = data.storage;
    warning.value = data.warning || '';
    defaultInUse.value = Boolean(data.defaultInUse);
  } catch (err) {
    ui.notify(describeError(err), 'error');
  } finally {
    loading.value = false;
  }
}

onMounted(load);

async function add() {
  errors.username = /^[A-Za-z0-9_.-]{2,32}$/.test(draft.username) ? '' : '用户名需为 2-32 位字母、数字、_ . -';
  errors.password = draft.password.length >= 8 ? '' : '新密码至少 8 位';
  if (errors.username || errors.password) return;
  busy.value = true;
  try {
    const data = await api.post('/api/users', { ...draft });
    items.value = data.items;
    draft.username = '';
    draft.password = '';
    draft.displayName = '';
    ui.notify('用户已登记，其既有会话已被强制失效', 'commit');
  } catch (err) {
    ui.notify(describeError(err), 'error');
  } finally {
    busy.value = false;
  }
}

async function remove(username) {
  busy.value = true;
  try {
    const data = await api.del(`/api/users/${encodeURIComponent(username)}`);
    items.value = data.items;
    confirmTarget.value = '';
    ui.notify(`已移除用户 ${username}`, 'commit');
  } catch (err) {
    ui.notify(describeError(err), 'error');
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <div class="sheet-inner">
    <header class="sheet-head">
      <h1 class="sheet-title">用户名册</h1>
      <div class="sheet-title-rule" aria-hidden="true"></div>
      <p class="sheet-lead">可登录用户以 CSV 明文登记于服务端数据目录，此处即该文件的读写界面。</p>
    </header>

    <p v-if="warning" class="banner" role="alert">
      <b>口令存储：{{ storage }}</b>
      <span>{{ warning }}</span>
    </p>
    <p v-else-if="defaultInUse" class="banner">
      <b>默认口令仍在使用</b><span>请立即修改 admin 的口令。</span>
    </p>

    <section class="pane">
      <div class="pane-head">
        <h2>名册</h2>
        <span class="micro-label">{{ items.length }} 人 · 存储 {{ storage }}</span>
      </div>
      <p v-if="loading" class="field-hint" aria-busy="true">读取中…</p>
      <div v-else class="table-scroll">
      <table class="users">
        <caption class="sr-only">可登录用户列表</caption>
        <thead>
          <tr>
            <th scope="col">用户名</th>
            <th scope="col">显示名</th>
            <th scope="col">角色</th>
            <th scope="col">登记时刻</th>
            <th scope="col">口令列</th>
            <th scope="col">操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in items" :key="row.username">
            <th scope="row">{{ row.username }}</th>
            <td>{{ row.displayName }}</td>
            <td>{{ row.role }}</td>
            <td class="tabular">{{ row.createdAt?.slice(0, 10) }}</td>
            <td class="tabular">{{ row.storage === 'plain' ? '明文' : 'scrypt' }}</td>
            <td>
              <button
                class="paper-btn btn-critical"
                type="button"
                :disabled="row.username === 'admin' || busy"
                :title="row.username === 'admin' ? '内置 admin 不可删除' : '移除该用户'"
                @click="confirmTarget = row.username"
              >
                移除
              </button>
            </td>
          </tr>
        </tbody>
      </table>
      </div>
    </section>

    <form class="pane" aria-label="新增可登录用户" @submit.prevent="add">
      <h2>登记新用户</h2>
      <div class="row two-col">
        <label class="field">
          <span class="field-label">用户名</span>
          <input
            v-model.trim="draft.username"
            class="paper-input"
            type="text"
            autocomplete="off"
            :aria-invalid="errors.username ? 'true' : 'false'"
          />
          <span v-if="errors.username" class="field-error" role="alert">{{ errors.username }}</span>
        </label>
        <label class="field">
          <span class="field-label">初始口令（≥8 位）</span>
          <input
            v-model="draft.password"
            class="paper-input"
            type="text"
            autocomplete="new-password"
            :aria-invalid="errors.password ? 'true' : 'false'"
          />
          <span v-if="errors.password" class="field-error" role="alert">{{ errors.password }}</span>
        </label>
        <label class="field">
          <span class="field-label">显示名</span>
          <input v-model="draft.displayName" class="paper-input" type="text" maxlength="40" />
        </label>
        <label class="field">
          <span class="field-label">角色</span>
          <select v-model="draft.role" class="paper-select">
            <option value="editor">编辑</option>
            <option value="admin">管理员</option>
          </select>
        </label>
      </div>
      <button class="paper-btn seal-press" type="submit" :disabled="busy">
        {{ busy ? '写入中…' : '用印登记' }}
      </button>
      <p class="field-hint">同名提交即为改密；改密后该用户所有会话立即失效。</p>
    </form>

    <ConfirmDialog
      :open="Boolean(confirmTarget)"
      title="移除用户"
      :summary="`将把 ${confirmTarget} 从可登录名册中删除。`"
      consequence="该用户既有会话立即失效；其已归档的条目仍保留作者署名。"
      confirm-text="确认移除"
      :danger="true"
      :busy="busy"
      @confirm="remove(confirmTarget)"
      @cancel="confirmTarget = ''"
    />
  </div>
</template>

<style scoped>
.banner {
  display: grid;
  gap: 2px;
  padding: var(--space-3) var(--space-4);
  margin: 0 0 var(--space-4);
  background: var(--paper-deep);
  border: var(--grid-rule) solid var(--anno-gold);
  border-inline-start: 4px solid var(--anno-gold);
  font-size: var(--text-small);
}
.banner b {
  font-family: var(--font-display);
  color: var(--terra-signal-ink);
}
.users {
  inline-size: 100%;
  border-collapse: collapse;
  font-size: var(--text-small);
}
.users th,
.users td {
  text-align: start;
  padding: var(--space-2) var(--space-3);
  border-block-end: var(--grid-rule) solid var(--rule-quiet);
}
.users thead th {
  border-block-end: var(--frame-rule) solid var(--rule-firm);
  font-family: var(--font-display);
  letter-spacing: 0.08em;
  white-space: nowrap;
}
.two-col {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(14rem, 1fr));
  gap: 0 var(--space-4);
  inline-size: 100%;
}
</style>
