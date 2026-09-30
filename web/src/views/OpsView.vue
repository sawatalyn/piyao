<script setup>
import { computed, onMounted, ref } from 'vue';
import { useAuthStore } from '../stores/auth.js';
import { api, describeError } from '../api/client.js';
import ConfirmDialog from '../components/paper/ConfirmDialog.vue';

const auth = useAuthStore();

const media = ref(null);
const log = ref(null);
const busy = ref(false);
const error = ref('');
const note = ref('');
const pickedIds = ref([]);
const pickedFiles = ref([]);
const plan = ref(null);
const ask = ref(false);

const draft = ref({ event: '', ip: '', q: '' });

const human = (bytes) => {
  const n = Number(bytes) || 0;
  if (n > 1048576) return `${(n / 1048576).toFixed(2)} MB`;
  if (n > 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${n} B`;
};
const clock = (iso) => (iso ? String(iso).slice(0, 19).replace('T', ' ') : '—');

const deletable = computed(() => [
  ...pickedIds.value.map((id) => media.value?.unreferenced.find((row) => row.id === id)).filter(Boolean),
  ...pickedFiles.value.map((name) => media.value?.orphanFiles.find((row) => row.file === name)).filter(Boolean),
]);
const pickedBytes = computed(() => deletable.value.reduce((sum, row) => sum + (Number(row.bytes) || 0), 0));
const signalTotal = computed(() => (log.value?.signals || []).reduce((sum, row) => sum + row.count, 0));
const dayMax = computed(() => Math.max(1, ...(log.value?.byDay || []).map((row) => row.count)));

async function loadMedia() {
  busy.value = true;
  error.value = '';
  try {
    media.value = await api.get('/api/ops/media-report');
    pickedIds.value = [];
    pickedFiles.value = [];
    plan.value = null;
  } catch (err) {
    error.value = describeError(err);
  } finally {
    busy.value = false;
  }
}

async function loadLog() {
  busy.value = true;
  error.value = '';
  try {
    const params = new URLSearchParams();
    if (draft.value.event) params.set('event', draft.value.event);
    if (draft.value.ip) params.set('ip', draft.value.ip);
    if (draft.value.q) params.set('q', draft.value.q);
    log.value = await api.get(`/api/ops/security-log?${params.toString()}`);
  } catch (err) {
    error.value = describeError(err);
  } finally {
    busy.value = false;
  }
}

/** 预演：不带 confirm，服务端只回"将要删什么" */
async function preview() {
  note.value = '';
  busy.value = true;
  try {
    plan.value = await api.post('/api/ops/media-gc', { ids: pickedIds.value, files: pickedFiles.value, confirm: false });
    note.value = `预演：将删索引记录 ${plan.value.plan.indexRecords.length} 条、孤儿文件 ${plan.value.plan.orphanFiles.length} 个，约 ${human(plan.value.bytesFreed)}；被拒 ${plan.value.skipped.length} 项。`;
  } catch (err) {
    error.value = describeError(err);
  } finally {
    busy.value = false;
  }
}

async function commit() {
  ask.value = false;
  note.value = '';
  busy.value = true;
  try {
    const result = await api.post('/api/ops/media-gc', { ids: pickedIds.value, files: pickedFiles.value, confirm: true });
    note.value = `已清理：索引记录 ${result.removed.indexRecords.length} 条、孤儿文件 ${result.removed.orphanFiles.length} 个，释放约 ${human(result.bytesFreed)}；跳过 ${result.skipped.length} 项。`;
    await loadMedia();
  } catch (err) {
    error.value = describeError(err);
  } finally {
    busy.value = false;
  }
}

function toggle(list, value, on) {
  const set = new Set(list.value);
  if (on) set.add(value);
  else set.delete(value);
  list.value = [...set];
}

onMounted(async () => {
  if (!auth.isAuthed) return;
  await Promise.all([loadMedia(), loadLog()]);
});
</script>

<template>
  <div class="sheet-inner">
    <header class="sheet-head">
      <h1 class="sheet-title">馆务台账</h1>
      <div class="sheet-title-rule" aria-hidden="true"></div>
      <p class="sheet-lead">
        两件运维实事：<b>媒体对账</b>（磁盘文件、索引记录、在档引用三方核对，孤儿与死链要点名才清理）与
        <b>安全日志聚合</b>（<code>security.log</code> 的 JSONL 原样读，按事件、来源与日期汇总）。
      </p>
      <p class="micro-label">
        本站不引入 AGPL/SSPL 的现成日志栈作为依赖；要接外部采集器时直接 tail 这些 JSONL 文件（口径见 DEPLOY.md）。
      </p>
    </header>

    <p v-if="!auth.isAuthed" class="field-hint">此页需登录后查看。</p>

    <template v-else>
      <p v-if="error" class="field-error" role="alert">{{ error }}</p>
      <p v-if="note" class="field-hint" role="status">{{ note }}</p>

      <section class="pane" aria-label="媒体台账">
        <div class="pane-head">
          <h2 class="pane-title">媒体文件对账</h2>
          <span class="micro-label" :aria-busy="busy ? 'true' : 'false'">
            {{ media ? `磁盘 ${media.totals.diskFiles} 个 / 索引 ${media.totals.indexRecords} 条 / 可回收 ${human(media.totals.reclaimableBytes)}` : '读取中' }}
          </span>
          <button class="paper-btn btn-quiet" type="button" :disabled="busy" @click="loadMedia">重新对账</button>
        </div>
        <p v-if="!media" class="field-hint">尚未取得台账。</p>
        <template v-else>
          <div class="ledger">
            <div class="cell"><span class="micro-label">在档引用</span><b class="tabular">{{ media.totals.used }}</b></div>
            <div class="cell"><span class="micro-label">无引用记录</span><b class="tabular">{{ media.totals.unreferenced }}</b></div>
            <div class="cell"><span class="micro-label">磁盘孤儿</span><b class="tabular">{{ media.totals.orphanFiles }}</b></div>
            <div class="cell"><span class="micro-label">索引死链</span><b class="tabular">{{ media.totals.staleIndex }}</b></div>
            <div class="cell"><span class="micro-label">磁盘占用</span><b class="tabular">{{ human(media.totals.diskBytes) }}</b></div>
          </div>

          <h3 class="sub">索引里有、档案不再引用（{{ media.unreferenced.length }}）</h3>
          <p v-if="!media.unreferenced.length" class="field-hint">没有此类记录。</p>
          <ul v-else class="pick-list">
            <li v-for="row in media.unreferenced" :key="row.id">
              <label class="paper-check">
                <input
                  type="checkbox"
                  :checked="pickedIds.includes(row.id)"
                  @change="toggle(pickedIds, row.id, $event.target.checked)"
                />
                <span class="mono">{{ row.file }}</span>
              </label>
              <span class="micro-label">{{ human(row.bytes) }} · {{ row.uploadedBy }} · {{ clock(row.createdAt) }}</span>
            </li>
          </ul>

          <h3 class="sub">磁盘上有、索引里没有（{{ media.orphanFiles.length }}）</h3>
          <p v-if="!media.orphanFiles.length" class="field-hint">没有此类文件。</p>
          <ul v-else class="pick-list">
            <li v-for="row in media.orphanFiles" :key="row.file">
              <label class="paper-check">
                <input
                  type="checkbox"
                  :disabled="!row.mine"
                  :checked="pickedFiles.includes(row.file)"
                  @change="toggle(pickedFiles, row.file, $event.target.checked)"
                />
                <span class="mono">{{ row.file }}</span>
              </label>
              <span class="micro-label">
                {{ human(row.bytes) }} · {{ clock(row.mtime) }}
                <template v-if="row.sha256"> · sha256 {{ row.sha256.slice(0, 12) }}</template>
                <template v-else> · 非本站扩展名，不代作决定</template>
              </span>
            </li>
          </ul>

          <h3 class="sub">索引里有、磁盘上没了（{{ media.staleIndex.length }}）</h3>
          <p v-if="!media.staleIndex.length" class="field-hint">没有死链。</p>
          <ul v-else class="plain-list">
            <li v-for="row in media.staleIndex" :key="row.id" class="mono">
              {{ row.file }} <span class="micro-label">（{{ row.uploadedBy }} · {{ clock(row.createdAt) }}）</span>
            </li>
          </ul>
          <p class="field-hint">死链只能重传修复：删掉记录会让档案正文里的图片永久无解。</p>

          <div class="row">
            <button class="paper-btn" type="button" :disabled="busy || !(pickedIds.length || pickedFiles.length)" @click="preview">
              先预演
            </button>
            <button
              class="paper-btn btn-critical"
              type="button"
              :disabled="busy || !(pickedIds.length || pickedFiles.length)"
              @click="ask = true"
            >
              清理勾选（{{ pickedIds.length + pickedFiles.length }} 项 · 约 {{ human(pickedBytes) }}）
            </button>
          </div>
          <p class="field-hint">清理逐一点名执行，没有"全部清空"的按钮；仍被在档档案引用的一律拒绝删除。</p>
          <details v-if="plan" class="plan">
            <summary class="micro-label">
              预演清单：索引 {{ plan.plan.indexRecords.length }} 条 / 孤儿 {{ plan.plan.orphanFiles.length }} 个 / 被拒 {{ plan.skipped.length }} 项
            </summary>
            <ul class="plain-list">
              <li v-for="row in plan.plan.indexRecords" :key="`pi-${row.id}`" class="mono">
                {{ row.file }} <span class="micro-label">索引记录 · {{ human(row.bytes) }}</span>
              </li>
              <li v-for="row in plan.plan.orphanFiles" :key="`pf-${row.file}`" class="mono">
                {{ row.file }} <span class="micro-label">磁盘孤儿 · {{ human(row.bytes) }}</span>
              </li>
              <li v-for="(row, index) in plan.skipped" :key="`sk-${index}`" class="mono">
                {{ row.key }} <span class="micro-label">{{ row.reason }}</span>
              </li>
            </ul>
          </details>
        </template>
      </section>

      <section class="pane" aria-label="安全日志">
        <div class="pane-head">
          <h2 class="pane-title">安全日志聚合</h2>
          <span class="micro-label" :aria-busy="busy ? 'true' : 'false'">
            {{
              log
                ? `全量 ${log.totals.entries} 条 / 命中 ${log.totals.matched} 条 / ${log.totals.from ? clock(log.totals.from).slice(0, 10) : '—'} → ${clock(log.totals.to).slice(0, 10)} / 文件 ${log.scanned.join('、')}`
                : '读取中'
            }}
          </span>
        </div>
        <form class="row" @submit.prevent="loadLog">
          <label class="field grow">
            <span class="field-label">事件</span>
            <select v-model="draft.event" class="paper-select">
              <option value="">全部</option>
              <option v-for="row in log?.byEvent || []" :key="row.key" :value="row.key">{{ row.key }}（{{ row.count }}）</option>
            </select>
          </label>
          <label class="field">
            <span class="field-label">来源 IP</span>
            <input v-model.trim="draft.ip" class="paper-input" type="text" maxlength="64" placeholder="精确匹配" />
          </label>
          <label class="field grow">
            <span class="field-label">关键词</span>
            <input v-model.trim="draft.q" class="paper-input" type="search" maxlength="60" placeholder="如 path、口令标签" />
          </label>
          <button class="paper-btn seal-press" type="submit" :disabled="busy">查</button>
        </form>
        <p v-if="log?.totals.truncated" class="field-hint">日志超过读取上限，只统计了最近的一段；请用筛选收窄或走外部采集器。</p>

        <h3 class="sub">需要盯的事件</h3>
        <div class="table-scroll">
          <table class="lic-table">
            <thead><tr><th scope="col">事件</th><th scope="col">次数</th><th scope="col">最近一次</th></tr></thead>
            <tbody>
              <tr v-for="row in log?.signals || []" :key="row.key">
                <td class="mono">{{ row.key }}</td>
                <td class="tabular">{{ row.count }}</td>
                <td class="tabular">{{ clock(row.last) }}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p class="micro-label">合计 {{ signalTotal }} 次；其余事件为常规写入痕迹。</p>

        <h3 class="sub">按日分布</h3>
        <ul v-if="log?.byDay?.length" class="bars">
          <li v-for="row in log.byDay" :key="row.key">
            <span class="mono">{{ row.key }}</span>
            <i :style="{ inlineSize: `${Math.round((row.count / dayMax) * 100)}%` }"></i>
            <span class="tabular">{{ row.count }}</span>
          </li>
        </ul>
        <p v-else class="field-hint">日志为空。</p>

        <div class="table-scroll">
          <table class="lic-table">
            <thead><tr><th scope="col">时刻</th><th scope="col">事件</th><th scope="col">IP</th><th scope="col">用户</th><th scope="col">详情</th></tr></thead>
            <tbody>
              <tr v-for="(row, index) in log?.recent || []" :key="index">
                <td class="tabular">{{ clock(row.at) }}</td>
                <td class="mono">{{ row.event }}</td>
                <td class="mono">{{ row.ip || '—' }}</td>
                <td>{{ row.user || '—' }}</td>
                <td class="detail mono">{{ JSON.stringify(row, (k, v) => (['at', 'event', 'ip', 'user'].includes(k) ? undefined : v)) }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>
    </template>

    <ConfirmDialog
      :open="ask"
      title="清理媒体文件"
      :summary="`将删除 ${pickedIds.length} 条索引记录与 ${pickedFiles.length} 个磁盘孤儿，约 ${human(pickedBytes)}。`"
      consequence="文件删除后不可恢复；请先跑一次「先预演」确认清单，并确认档案正文里不再引用它们。"
      confirm-text="确认清理"
      danger
      @confirm="commit"
      @cancel="ask = false"
    />
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
.sub {
  margin: var(--space-4) 0 var(--space-2);
  font-family: var(--font-display);
  font-size: var(--text-small);
  color: var(--ink-mute);
  letter-spacing: 0.06em;
}
.pick-list,
.plain-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: var(--space-1);
}
.pick-list li,
.plain-list li {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  justify-content: space-between;
  gap: var(--space-2);
  padding: var(--space-1) var(--space-2);
  background: var(--paper-leaf);
  border: var(--grid-rule) solid var(--rule-quiet);
  border-radius: var(--control-radius);
}
.mono {
  font-family: var(--font-mono);
  font-size: var(--text-small);
  overflow-wrap: anywhere;
}
.grow {
  flex: 1 1 12rem;
}
.detail {
  max-inline-size: 28rem;
  overflow-wrap: anywhere;
  font-size: var(--text-micro);
  color: var(--ink-soft);
}
.bars {
  list-style: none;
  margin: 0 0 var(--space-3);
  padding: 0;
  display: grid;
  gap: 2px;
}
.bars li {
  display: grid;
  grid-template-columns: 6.5rem 1fr 3rem;
  align-items: center;
  gap: var(--space-2);
  font-size: var(--text-micro);
}
.bars i {
  display: block;
  block-size: 6px;
  min-inline-size: 2px;
  background: var(--terra-signal-ink);
  border-radius: 2px;
}
</style>
