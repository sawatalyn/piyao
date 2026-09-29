<script setup>
import { computed, onMounted, ref } from 'vue';
import { useAuthStore } from '../stores/auth.js';
import { useLibraryStore } from '../stores/library.js';
import { describeError } from '../api/client.js';
import ConfirmDialog from '../components/paper/ConfirmDialog.vue';

const auth = useAuthStore();
const library = useLibraryStore();

const blankKey = () => ({ code: '', label: '', hint: '', scope: 'all', fileIds: [], expiresAt: '' });
const blankBook = () => ({ file: '', title: '', author: '', translator: '', group: '', note: '', sourceUrl: '', rights: '' });

const code = ref('');
const keyDraft = ref(blankKey());
const bookDraft = ref(blankBook());
const busy = ref(false);
const error = ref('');
const removal = ref(null);
const keyRemoval = ref(null);

const human = (bytes) =>
  bytes > 1048576 ? `${(bytes / 1048576).toFixed(2)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;

const grantUntil = computed(() =>
  library.grant ? new Date(library.grant.expiresAt).toLocaleTimeString('zh-CN', { hour12: false }) : ''
);

onMounted(async () => {
  await library.load();
  if (auth.isAuthed) await library.loadManaged().catch(() => undefined);
});

async function submitUnlock() {
  busy.value = true;
  error.value = '';
  const ok = await library.unlock(code.value);
  if (!ok) error.value = '口令不正确、已停用或尝试过于频繁';
  else code.value = '';
  busy.value = false;
}

function pickPending(item) {
  bookDraft.value = { ...blankBook(), file: item.file, title: item.file.replace(/\.(epub|pdf)$/i, '') };
}

async function registerBook() {
  busy.value = true;
  error.value = '';
  try {
    await library.register(bookDraft.value);
    bookDraft.value = blankBook();
  } catch (err) {
    error.value = describeError(err);
  } finally {
    busy.value = false;
  }
}

async function toggleBook(item) {
  await library.updateBook(item.id, { ...item, enabled: !item.enabled });
}

async function confirmRemoveBook() {
  await library.unregister(removal.value.id);
  removal.value = null;
}

async function addKey() {
  busy.value = true;
  error.value = '';
  try {
    await library.addKey({
      ...keyDraft.value,
      fileIds: keyDraft.value.scope === 'files' ? keyDraft.value.fileIds : [],
      expiresAt: keyDraft.value.expiresAt ? new Date(keyDraft.value.expiresAt).getTime() : 0,
    });
    keyDraft.value = blankKey();
  } catch (err) {
    error.value = describeError(err);
  } finally {
    busy.value = false;
  }
}

async function toggleKey(item) {
  await library.patchKey(item.id, { ...item, active: !item.active });
}

async function confirmRemoveKey() {
  await library.removeKey(keyRemoval.value.id);
  keyRemoval.value = null;
}

function fileIdList(event) {
  keyDraft.value.fileIds = [...event.target.selectedOptions].map((option) => option.value);
}
</script>

<template>
  <div class="sheet-inner">
    <header class="sheet-head">
      <h1 class="sheet-title">洛琪希图书馆 · 本地镜像</h1>
      <div class="sheet-title-rule" aria-hidden="true"></div>
      <p class="sheet-lead">
        为<b>借书柜台</b>的访谈与翻译合集做本地备份：柜上条目一旦失效，本馆仍可取阅。
        所有人可读目录，<b>输入口令后即可在线阅览或下载</b>；口令由登录馆员签发、停用与吊销。
      </p>
      <p class="micro-label">
        在架 {{ library.books.length }} 册 · 单次令牌
        <span class="tabular">{{ Math.round(library.meta.grantTtlMs / 60000) }}</span> 分钟 ·
        目录 <span class="mono">{{ library.meta.dir }}</span>
      </p>
    </header>

    <section class="pane gate" aria-label="口令解锁">
      <div class="pane-head">
        <h2 class="pane-title">入馆口令</h2>
        <span v-if="library.unlocked" class="badge-ok">已解锁至 {{ grantUntil }}</span>
        <span v-else class="micro-label">向馆方索取口令</span>
      </div>
      <form class="row" @submit.prevent="submitUnlock">
        <label class="field grow">
          <span class="field-label">口令</span>
          <input
            v-model="code"
            class="paper-input"
            type="password"
            autocomplete="off"
            maxlength="40"
            :disabled="library.unlocked"
            placeholder="输入口令后可直接取书"
          />
        </label>
        <button class="paper-btn seal-press" type="submit" :disabled="busy || library.unlocked || !code" :aria-busy="busy ? 'true' : 'false'">
          {{ library.unlocked ? '已解锁' : '验印入馆' }}
        </button>
      </form>
      <p v-if="error" class="field-error" role="alert">{{ error }}</p>
      <p class="field-hint">连错若干次会按 IP 冷却；令牌只证明"此人已输入正确口令"，不改变书目可见性。</p>
    </section>

    <section class="pane" aria-label="在架书目">
      <div class="pane-head">
        <h2 class="pane-title">在架书目</h2>
        <span class="micro-label">{{ library.books.length }} 册</span>
      </div>
      <p v-if="library.loading" class="field-hint" aria-busy="true">读取中…</p>
      <div class="table-scroll">
        <table class="lic-table">
          <thead>
            <tr>
              <th scope="col">书名</th><th scope="col">著 / 译</th><th scope="col">册别</th>
              <th scope="col">体积</th><th scope="col">权利声明</th><th scope="col">阅览</th><th scope="col">取书</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="item in library.books" :key="item.id">
              <td>
                {{ item.title }}
                <a v-if="item.sourceUrl" class="src-link" :href="item.sourceUrl" target="_blank" rel="noopener noreferrer nofollow">来源</a>
              </td>
              <td>{{ [item.author, item.translator].filter(Boolean).join(' / ') || '—' }}</td>
              <td>{{ item.group || '—' }}</td>
              <td class="tabular">{{ human(item.bytes) }}</td>
              <td class="rights">{{ item.rights || '未声明' }}</td>
              <td>
                <router-link
                  v-if="item.type === 'application/epub+zip'"
                  class="paper-btn btn-quiet"
                  :to="{ path: `/library/${item.id}/read`, query: { c: 0, p: 1 } }"
                  >在线阅览</router-link
                >
                <span v-else class="micro-label">仅可下载</span>
              </td>
              <td>
                <a
                  v-if="library.unlocked"
                  class="paper-btn"
                  :href="library.downloadUrl(item.id)"
                  download
                >取书</a>
                <button v-else class="paper-btn btn-quiet" type="button" disabled title="需先输入口令">取书</button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <p v-if="!library.books.length" class="field-hint">架上暂无书：请馆员把文件放入镜像目录后登记。</p>
    </section>

    <template v-if="auth.isAuthed">
      <section class="pane" aria-label="登记本地文件">
        <div class="pane-head">
          <h2 class="pane-title">登记本地文件</h2>
          <span class="micro-label">待登记 {{ library.pending.length }} 个</span>
        </div>
        <p class="field-hint">
          文件须由馆员自行放入 <code>{{ library.meta.dir }}</code>；本站不代为抓取网盘内容。
          收录他人作品前请确认授权，并在"权利声明"里写明依据。
        </p>
        <ul v-if="library.pending.length" class="pending-list">
          <li v-for="item in library.pending" :key="item.file">
            <button class="tagline" type="button" @click="pickPending(item)">
              <span>{{ item.file }}</span>
              <span class="tabular">{{ human(item.bytes) }}</span>
            </button>
          </li>
        </ul>
        <p v-else class="micro-label">目录内没有未登记的文件。</p>

        <div class="row two-col">
          <label class="field">
            <span class="field-label">文件名<i aria-hidden="true">*</i></span>
            <input v-model.trim="bookDraft.file" class="paper-input" type="text" maxlength="200" />
          </label>
          <label class="field">
            <span class="field-label">书名<i aria-hidden="true">*</i></span>
            <input v-model.trim="bookDraft.title" class="paper-input" type="text" maxlength="120" />
          </label>
        </div>
        <div class="row three-col">
          <label class="field"><span class="field-label">作者</span><input v-model.trim="bookDraft.author" class="paper-input" type="text" maxlength="60" /></label>
          <label class="field"><span class="field-label">译者</span><input v-model.trim="bookDraft.translator" class="paper-input" type="text" maxlength="60" /></label>
          <label class="field"><span class="field-label">册别/合集</span><input v-model.trim="bookDraft.group" class="paper-input" type="text" maxlength="40" /></label>
        </div>
        <label class="field">
          <span class="field-label">来源链接</span>
          <input v-model.trim="bookDraft.sourceUrl" class="paper-input" type="url" maxlength="500" placeholder="https://…" />
        </label>
        <label class="field">
          <span class="field-label">权利声明</span>
          <textarea v-model="bookDraft.rights" class="paper-input" rows="2" maxlength="200" placeholder="如：译者公开发布且允许备份转载，已注明出处"></textarea>
        </label>
        <p v-if="error" class="field-error" role="alert">{{ error }}</p>
        <button class="paper-btn seal-press" type="button" :disabled="busy || !bookDraft.file || !bookDraft.title" @click="registerBook">
          用印登记
        </button>
      </section>

      <section class="pane" aria-label="书目管理">
        <div class="pane-head">
          <h2 class="pane-title">书目上下架</h2>
          <span class="micro-label">下架只撤登记，不删磁盘原件</span>
        </div>
        <div class="table-scroll">
          <table class="lic-table">
            <thead><tr><th scope="col">书名</th><th scope="col">磁盘文件</th><th scope="col">校验</th><th scope="col">状态</th><th scope="col">操作</th></tr></thead>
            <tbody>
              <tr v-for="item in library.booksFull" :key="item.id">
                <td>{{ item.title }}</td>
                <td class="mono">{{ item.file || '—' }}</td>
                <td class="mono">{{ item.sha256 ? item.sha256.slice(0, 12) : '—' }}</td>
                <td>{{ item.enabled === false ? '已下架' : '在架' }}</td>
                <td class="row-actions">
                  <button class="paper-btn btn-quiet" type="button" @click="toggleBook(item)">{{ item.enabled === false ? '上架' : '下架' }}</button>
                  <button class="paper-btn btn-critical" type="button" @click="removal = item">取消登记</button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <section class="pane" aria-label="口令管理">
        <div class="pane-head">
          <h2 class="pane-title">口令管理</h2>
          <span class="micro-label">{{ library.keys.length }} 条 · 明文存于服务端数据目录，与名册同一取舍</span>
        </div>
        <div class="row two-col">
          <label class="field">
            <span class="field-label">口令<i aria-hidden="true">*</i></span>
            <input v-model="keyDraft.code" class="paper-input" type="text" maxlength="40" placeholder="4-40 个字符" />
          </label>
          <label class="field">
            <span class="field-label">名称</span>
            <input v-model.trim="keyDraft.label" class="paper-input" type="text" maxlength="40" placeholder="如：对外发放·2026 秋" />
          </label>
        </div>
        <div class="row two-col">
          <label class="field">
            <span class="field-label">范围</span>
            <select v-model="keyDraft.scope" class="paper-select">
              <option value="all">全部在架书</option>
              <option value="files">指定书目</option>
            </select>
          </label>
          <label class="field">
            <span class="field-label">到期（留空＝长期）</span>
            <input v-model="keyDraft.expiresAt" class="paper-input" type="date" />
          </label>
        </div>
        <label v-if="keyDraft.scope === 'files'" class="field">
          <span class="field-label">指定书目（可多选）</span>
          <select class="paper-select" multiple size="4" @change="fileIdList">
            <option v-for="item in library.books" :key="item.id" :value="item.id">{{ item.title }}</option>
          </select>
        </label>
        <label class="field">
          <span class="field-label">给读者的提示</span>
          <input v-model.trim="keyDraft.hint" class="paper-input" type="text" maxlength="120" placeholder="如：口令见本馆公告页" />
        </label>
        <button class="paper-btn seal-press" type="button" :disabled="busy || keyDraft.code.length < 4" @click="addKey">签发口令</button>

        <div class="table-scroll">
          <table class="lic-table">
            <thead><tr><th scope="col">名称</th><th scope="col">口令</th><th scope="col">范围</th><th scope="col">到期</th><th scope="col">取书次数</th><th scope="col">状态</th><th scope="col">操作</th></tr></thead>
            <tbody>
              <tr v-for="item in library.keys" :key="item.id">
                <td>{{ item.label }}<p v-if="item.hint" class="micro-label">{{ item.hint }}</p></td>
                <td class="mono">{{ item.code }}</td>
                <td>{{ item.scope === 'all' ? '全部' : `指定 ${item.fileIds.length} 册` }}</td>
                <td>{{ item.expiresAt ? new Date(item.expiresAt).toLocaleDateString('zh-CN') : '长期' }}</td>
                <td class="tabular">{{ item.downloads || 0 }}</td>
                <td>{{ item.active ? '生效' : '已停用' }}</td>
                <td class="row-actions">
                  <button class="paper-btn btn-quiet" type="button" @click="toggleKey(item)">{{ item.active ? '停用' : '启用' }}</button>
                  <button class="paper-btn btn-critical" type="button" @click="keyRemoval = item">吊销</button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>
    </template>

    <ConfirmDialog
      :open="Boolean(removal)"
      title="取消登记"
      :summary="removal ? `将从架上撤下《${removal.title}》，磁盘原件保留在镜像目录内。` : ''"
      consequence="撤下后游客立即无法取书；如需彻底删除文件，请馆员自行在服务器上处理。"
      confirm-text="确认撤下"
      danger
      @confirm="confirmRemoveBook"
      @cancel="removal = null"
    />
    <ConfirmDialog
      :open="Boolean(keyRemoval)"
      title="吊销口令"
      :summary="keyRemoval ? `口令「${keyRemoval.label}」将被永久删除，已发出的令牌随即失效。` : ''"
      consequence="持有该口令的读者需重新索取口令。"
      confirm-text="确认吊销"
      danger
      @confirm="confirmRemoveKey"
      @cancel="keyRemoval = null"
    />
  </div>
</template>

<style scoped>
.gate .row {
  align-items: flex-end;
}
.grow {
  flex: 1 1 12rem;
}
.badge-ok {
  font-size: var(--text-micro);
  color: var(--terra-signal-ink);
  border: var(--grid-rule) solid currentColor;
  padding: 1px 6px;
  border-radius: var(--control-radius);
}
.mono {
  font-family: var(--font-mono);
  font-size: var(--text-micro);
}
.rights {
  font-size: var(--text-micro);
  color: var(--ink-soft);
  max-width: 18rem;
}
.src-link {
  margin-inline-start: var(--space-2);
  font-size: var(--text-micro);
  color: var(--ink-mute);
}
.pending-list {
  list-style: none;
  margin: 0 0 var(--space-3);
  padding: 0;
  display: grid;
  gap: var(--space-1);
}
.tagline {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
  inline-size: 100%;
  min-height: var(--control-min-h);
  padding: var(--space-1) var(--space-3);
  background: var(--paper-leaf);
  border: var(--grid-rule) solid var(--rule-quiet);
  border-inline-start: 3px solid var(--rule-quiet);
  border-radius: var(--control-radius);
  color: var(--ink-soft);
  font-size: var(--text-small);
  cursor: pointer;
  text-align: start;
}
.tagline:hover {
  border-inline-start-color: var(--rule-firm);
}
.tagline:focus-visible {
  outline: var(--focus-ring) solid var(--terra-ink);
  outline-offset: 2px;
}
.row-actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-1);
}
</style>
