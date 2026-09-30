<script setup>
import { computed, onMounted, ref } from 'vue';
import { useAuthStore } from '../stores/auth.js';
import { api, describeError } from '../api/client.js';

const auth = useAuthStore();

const ledger = ref(null);
const busy = ref(false);
const error = ref('');
const draft = ref({ post: '', kind: '' });

const KIND = { create: '建档', update: '修订' };
const human = (bytes) => {
  const n = Number(bytes) || 0;
  if (n > 1048576) return `${(n / 1048576).toFixed(2)} MB`;
  if (n > 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${n} B`;
};
const clock = (iso) => (iso ? String(iso).slice(0, 19).replace('T', ' ') : '—');

const items = computed(() => ledger.value?.items || []);
const posts = computed(() => ledger.value?.posts || []);
const filtered = computed(() => Boolean(draft.value.post || draft.value.kind));

async function load() {
  busy.value = true;
  error.value = '';
  try {
    const params = new URLSearchParams();
    if (draft.value.post) params.set('post', draft.value.post);
    if (draft.value.kind) params.set('kind', draft.value.kind);
    ledger.value = await api.get(`/api/ops/revisions?${params.toString()}`);
  } catch (err) {
    error.value = describeError(err);
  } finally {
    busy.value = false;
  }
}

function reset() {
  draft.value = { post: '', kind: '' };
  return load();
}

onMounted(async () => {
  if (!auth.isAuthed) return;
  await load();
});
</script>

<template>
  <div class="sheet-inner">
    <header class="sheet-head">
      <h1 class="sheet-title">版本台账</h1>
      <div class="sheet-title-rule" aria-hidden="true"></div>
      <p class="sheet-lead">
        全站口径的核查台账：每一次<b>建档</b>与<b>修订</b>都留下一份完整快照，这里看的是"谁在哪一档留了几版、
        占了多少地方"。要看某一档的两版差异，进它的<b>版本清单</b>再选基线与对照。
      </p>
      <p class="micro-label">
        每档只保留最近 <span class="tabular">{{ ledger?.totals.keep ?? 30 }}</span> 版（<code>BW_REVISION_KEEP</code>）；
        <b>撤档不抹历史</b>——档案删了，它在档期间的版本仍留在这里，下表会标出「已撤档」。
      </p>
    </header>

    <p v-if="!auth.isAuthed" class="field-hint">此页需登录后查看。</p>

    <template v-else>
      <p v-if="error" class="field-error" role="alert">{{ error }}</p>

      <section class="pane" aria-label="台账口径">
        <div class="pane-head">
          <h2 class="pane-title">台账口径</h2>
          <span class="micro-label" :aria-busy="busy ? 'true' : 'false'">
            {{ ledger ? `全量 ${ledger.totals.entries} 版 / 命中 ${ledger.totals.matched} 版 / 涉及 ${ledger.totals.posts} 档` : '读取中' }}
          </span>
          <button class="paper-btn btn-quiet" type="button" :disabled="busy" @click="load">重新读取</button>
        </div>
        <p v-if="!ledger" class="field-hint">尚未取得台账。</p>
        <div v-else class="ledger">
          <div class="cell"><span class="micro-label">版本总数</span><b class="tabular">{{ ledger.totals.entries }}</b></div>
          <div class="cell"><span class="micro-label">涉及档案</span><b class="tabular">{{ ledger.totals.posts }}</b></div>
          <div class="cell"><span class="micro-label">快照占用</span><b class="tabular">{{ human(ledger.totals.bytes) }}</b></div>
          <div class="cell"><span class="micro-label">每档保留</span><b class="tabular">{{ ledger.totals.keep }}</b></div>
          <div class="cell"><span class="micro-label">已撤档仍在册</span><b class="tabular">{{ ledger.totals.orphanPosts }}</b></div>
        </div>
        <p class="field-hint">
          体积按快照序列化后的字节数计，用来盯 <code>revisions.json</code> 会不会长成大文件；
          真要长期留档请导出到备份，而不是把保留数调大。
        </p>
      </section>

      <section class="pane" aria-label="版本流水">
        <div class="pane-head">
          <h2 class="pane-title">版本流水</h2>
          <span class="micro-label" :aria-busy="busy ? 'true' : 'false'">
            {{ ledger ? `列出 ${items.length} 版（最新在前）${ledger.truncated ? ' · 已截断' : ''}` : '读取中' }}
          </span>
        </div>
        <form class="row" @submit.prevent="load">
          <label class="field grow">
            <span class="field-label">档案</span>
            <select v-model="draft.post" class="paper-select">
              <option value="">全部</option>
              <option v-for="row in posts" :key="row.postId" :value="row.postId">
                {{ row.title || row.postId }}（{{ row.count }} 版）
              </option>
            </select>
          </label>
          <label class="field">
            <span class="field-label">动作</span>
            <select v-model="draft.kind" class="paper-select">
              <option value="">全部</option>
              <option value="create">建档</option>
              <option value="update">修订</option>
            </select>
          </label>
          <button class="paper-btn seal-press" type="submit" :disabled="busy">查</button>
          <button v-if="filtered" class="paper-btn btn-quiet" type="button" :disabled="busy" @click="reset">清空筛选</button>
        </form>
        <p v-if="ledger?.truncated" class="field-hint">命中超过单页上限，只列最新的一段；请用筛选收窄。</p>

        <div class="table-scroll">
          <table class="lic-table">
            <thead>
              <tr>
                <th scope="col">时刻</th><th scope="col">档案</th><th scope="col">版本</th>
                <th scope="col">动作</th><th scope="col">经手</th><th scope="col">当时标题</th>
                <th scope="col">正文字数</th><th scope="col">快照</th><th scope="col">比对</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="row in items" :key="row.id" :class="{ 'is-gone': row.alive === false }">
                <td class="tabular">{{ clock(row.at) }}</td>
                <td>{{ row.alive === false ? '（已撤档）' : row.title || row.postId }}</td>
                <td class="tabular">v{{ row.version }}</td>
                <td>{{ KIND[row.kind] || row.kind }}</td>
                <td>{{ row.by }}</td>
                <td class="detail">{{ row.title }}</td>
                <td class="tabular">谣 {{ row.charCount.rumor }} / 辟 {{ row.charCount.verdict }}</td>
                <td class="tabular">{{ human(row.bytes) }}</td>
                <td class="row-actions">
                  <RouterLink class="paper-btn btn-quiet" :to="{ name: 'revisions', params: { id: row.postId } }">版本清单</RouterLink>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <p v-if="ledger && !items.length" class="field-hint">这个筛选下没有版本记录。</p>
      </section>

      <section class="pane" aria-label="按档案汇总">
        <div class="pane-head">
          <h2 class="pane-title">按档案汇总</h2>
          <span class="micro-label">{{ posts.length }} 档 · 按最新一版排序</span>
        </div>
        <div class="table-scroll">
          <table class="lic-table">
            <thead>
              <tr><th scope="col">档案</th><th scope="col">版本数</th><th scope="col">占用</th><th scope="col">最新一版</th><th scope="col">状态</th><th scope="col">比对</th></tr>
            </thead>
            <tbody>
              <tr v-for="row in posts" :key="row.postId">
                <td>{{ row.title || row.postId }}</td>
                <td class="tabular">{{ row.count }}<span v-if="row.count >= (ledger?.totals.keep ?? 30)" class="micro-label"> ·已到保留上限</span></td>
                <td class="tabular">{{ human(row.bytes) }}</td>
                <td class="tabular">{{ clock(row.latestAt) }}</td>
                <td>{{ row.alive ? '在档' : '已撤档（历史保留）' }}</td>
                <td class="row-actions">
                  <RouterLink class="paper-btn btn-quiet" :to="{ name: 'revisions', params: { id: row.postId } }">版本清单</RouterLink>
                  <RouterLink v-if="row.alive" class="paper-btn btn-quiet" :to="{ name: 'post', params: { id: row.postId } }">看档案</RouterLink>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <p v-if="ledger && !posts.length" class="field-hint">台账还是空的：建档或修订一次档案就会留下第一版。</p>
      </section>
    </template>
  </div>
</template>

<style scoped>
.ledger {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2) var(--space-5);
  margin: var(--space-3) 0;
  padding: var(--space-2) var(--space-3);
  border-block: var(--grid-rule) solid var(--rule-quiet);
}
.cell {
  display: grid;
  gap: 2px;
}
.row-actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-1);
}
.is-gone td {
  color: var(--ink-mute);
}
.detail {
  max-inline-size: 26ch;
  overflow-wrap: anywhere;
}
</style>
