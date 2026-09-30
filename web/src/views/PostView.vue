<script setup>
import { computed, ref, watch } from 'vue';
import { RouterLink, useRoute, useRouter } from 'vue-router';
import RichHtml from '../components/paper/RichHtml.vue';
import ConfirmDialog from '../components/paper/ConfirmDialog.vue';
import { describeError } from '../api/client.js';
import { useAuthStore } from '../stores/auth.js';
import { useCatalogStore } from '../stores/catalog.js';
import { useUiStore } from '../stores/ui.js';

const route = useRoute();
const router = useRouter();
const auth = useAuthStore();
const catalog = useCatalogStore();
const ui = useUiStore();

const post = ref(null);
const loading = ref(true);
const error = ref('');
const busy = ref(false);
const confirmDelete = ref(false);
const justCommitted = ref('');

async function load() {
  loading.value = true;
  error.value = '';
  try {
    post.value = await catalog.openPost(String(route.params.id));
  } catch (err) {
    error.value = describeError(err);
  } finally {
    loading.value = false;
  }
}

watch(() => route.params.id, load, { immediate: true });

const mediaUrl = computed(() => new Map((post.value?.media || []).map((m) => [m.id, m.url])));

const sourceRows = computed(() =>
  (post.value?.sources || []).map((source) => ({
    ...source,
    image: source.mediaId ? mediaUrl.value.get(source.mediaId) : '',
  }))
);

const reviewState = computed(() => {
  const raw = post.value?.meta?.reviewAt;
  if (!raw) return { label: '未设复核日', overdue: false };
  const date = new Date(raw);
  const overdue = date.getTime() < Date.now();
  return {
    label: `${date.toISOString().slice(0, 10)} ${overdue ? '已逾期，待重检' : '前须复核'}`,
    overdue,
  };
});

const day = (value) => (value ? new Date(value).toISOString().slice(0, 10) : '—');

async function togglePin() {
  if (!post.value) return;
  busy.value = true;
  try {
    const next = !post.value.pinned;
    const data = await catalog.setPinned(post.value.id, next);
    post.value = { ...post.value, pinned: next };
    justCommitted.value = next ? 'pinned' : 'unpinned';
    ui.notify(
      next
        ? `已置顶《${post.value.title}》${data.released ? `，原置顶《${data.released}》自动解除` : ''}`
        : '已取消置顶，首页恢复按卷次顺序排列',
      'commit'
    );
    setTimeout(() => {
      justCommitted.value = '';
    }, 900);
  } catch (err) {
    ui.notify(describeError(err), 'error');
  } finally {
    busy.value = false;
  }
}

async function removePost() {
  busy.value = true;
  try {
    await catalog.removePost(post.value.id);
    ui.notify('档案已删除', 'commit');
    confirmDelete.value = false;
    await router.push({ name: 'home' });
  } catch (err) {
    ui.notify(describeError(err), 'error');
  } finally {
    busy.value = false;
  }
}

function tagLink(tag) {
  return { name: 'home', query: { tag } };
}
</script>

<template>
  <div v-if="loading" class="sheet-inner" aria-busy="true">
    <div class="paper-progress">
      <span class="micro-label">正在调卷</span>
      <progress indeterminate max="1">调卷中</progress>
    </div>
  </div>

  <div v-else-if="error" class="sheet-inner">
    <p class="list-error" role="alert">{{ error }}</p>
    <RouterLink class="paper-btn" :to="{ name: 'home' }">返回卷首</RouterLink>
  </div>

  <div v-else-if="post" class="sheet-inner">
    <header class="sheet-head">
      <p class="crumb">
        <RouterLink :to="{ name: 'home' }">卷首</RouterLink>
        <span aria-hidden="true">›</span>
        <span>辟谣档案</span>
        <span v-if="post.pinned" class="pin-flag">置顶</span>
      </p>
      <h1 class="sheet-title">{{ post.title }}</h1>
      <div class="sheet-title-rule" aria-hidden="true"></div>

      <p class="verdict-line">
        <span class="micro-label">结论判定</span>
        <strong class="verdict" :class="`verdict-${post.verdict.rating || 'none'}`">
          {{ post.verdict.rating || '未判定' }}
        </strong>
        <span v-if="post.rumor.source?.platform" class="src-line">
          传自 {{ post.rumor.source.platform }}
          <template v-if="post.rumor.source.seenAt">
            · 见于 {{ day(post.rumor.source.seenAt) }}
          </template>
          <a
            v-if="post.rumor.source.url"
            :href="post.rumor.source.url"
            target="_blank"
            rel="noopener noreferrer nofollow"
            >查看原始载体</a
          >
        </span>
      </p>

      <p v-if="post.tags.length" class="tag-row">
        <RouterLink v-for="tag in post.tags" :key="tag" class="tagchip" :to="tagLink(tag)">{{ tag }}</RouterLink>
      </p>
    </header>

    <!-- 状态文书：批注栏职责、生效与期限，各字段唯一归属 -->
    <section class="dossier" aria-label="档案状态文书">
      <h2 class="micro-label">状态文书</h2>
      <dl>
        <div>
          <dt>责任编辑</dt>
          <dd>{{ post.meta.editor || post.author }}</dd>
        </div>
        <div>
          <dt>生效日期</dt>
          <dd class="tabular">{{ day(post.meta.publishedAt) }}</dd>
        </div>
        <div>
          <dt>复核期限</dt>
          <dd :data-overdue="reviewState.overdue ? 'true' : undefined">{{ reviewState.label }}</dd>
        </div>
        <div>
          <dt>传播范围</dt>
          <dd>{{ post.meta.scope || '—' }}</dd>
        </div>
        <div>
          <dt>危害等级</dt>
          <dd>{{ post.meta.level }}</dd>
        </div>
        <div>
          <dt>最近修订</dt>
          <dd class="tabular">
            {{ post.reviser || post.author }} · {{ day(post.updatedAt) }}
          </dd>
        </div>
      </dl>
    </section>

    <!-- 双栏对勘：谣言 ↔ 辟谣，中缝界栏 -->
    <section class="collation" aria-label="谣言与辟谣对勘">
      <article class="collation-col">
        <h2 class="collation-head" data-side="rumor">
          <span>谣言案例</span>
          <span class="micro-label">Claim</span>
        </h2>
        <RichHtml :html="post.rumor.html" :annotations="post.annotations" />
      </article>

      <div class="collation-rule" aria-hidden="true"></div>

      <article class="collation-col">
        <h2 class="collation-head" data-side="verdict">
          <span>辟谣内容</span>
          <span class="micro-label">Verdict</span>
        </h2>
        <RichHtml :html="post.verdict.html" :annotations="post.annotations" />
      </article>
    </section>

    <section class="pane">
      <div class="pane-head">
        <h2>辟谣材料源</h2>
        <span class="micro-label">{{ sourceRows.length }} 条 · 登记流转机构与采集时刻</span>
      </div>

      <p v-if="!sourceRows.length" class="field-hint">本条尚未登记材料源。</p>
      <ol class="slip-list">
        <li v-for="(source, index) in sourceRows" :key="source.id" class="record-slip slip-row">
          <span class="slip-no tabular">{{ String(index + 1).padStart(2, '0') }}</span>
          <div class="slip-main">
            <component
              :is="source.url ? 'a' : 'span'"
              class="slip-title"
              :href="source.url || undefined"
              :target="source.url ? '_blank' : undefined"
              :rel="source.url ? 'noopener noreferrer nofollow' : undefined"
            >
              {{ source.title || '（未命名材料）' }}
            </component>
            <p class="slip-meta">
              <span>机构 {{ source.org || '未登记' }}</span>
              <span class="tabular">采集 {{ day(source.collectedAt) }}</span>
              <span v-if="source.note">备注 {{ source.note }}</span>
            </p>
          </div>
          <img v-if="source.image" class="slip-thumb" :src="source.image" :alt="`材料附图：${source.title}`" loading="lazy" decoding="async" />
        </li>
      </ol>
    </section>

    <!-- 卷尾折叠文书块：承诺区，仅登录可用 -->
    <section class="decision" aria-label="档案操作">
      <div class="row">
        <RouterLink class="paper-btn btn-quiet" :to="{ name: 'revisions', params: { id: post.id } }">
          版本与比对
        </RouterLink>
        <span class="micro-label">每一次修订都留了完整快照，可比对任意两版的逐字段差异。</span>
      </div>
      <template v-if="auth.isAuthed">
        <div class="row">
          <button
            class="paper-btn seal-press"
            type="button"
            :disabled="busy"
            :aria-busy="busy ? 'true' : 'false'"
            @click="togglePin"
          >
            <span class="seal-mark" :data-just-committed="justCommitted ? 'true' : 'false'">印</span>
            {{ post.pinned ? '取消置顶' : '置顶本条' }}
          </button>
          <RouterLink class="paper-btn" :to="{ name: 'edit', params: { id: post.id } }">修订本条</RouterLink>
          <button class="paper-btn btn-critical" type="button" :disabled="busy" @click="confirmDelete = true">
            删除档案
          </button>
        </div>
        <p class="decision-note">
          置顶为全局唯一：确认后原置顶档案自动解除，本条排在卷首第一位。删除不可撤销。
        </p>
      </template>
      <p v-else class="decision-note">
        当前为游客身份，仅可浏览与检索。
        <RouterLink :to="{ name: 'login', query: { next: route.fullPath } }">登录</RouterLink>
        后可修订、置顶或删除。
      </p>
    </section>

    <ConfirmDialog
      :open="confirmDelete"
      title="删除档案"
      :summary="`将永久删除《${post.title}》及其材料源与批注记录。`"
      consequence="删除后无法从界面恢复；如需留档请先复制正文。"
      confirm-text="确认删除"
      :danger="true"
      :busy="busy"
      @confirm="removePost"
      @cancel="confirmDelete = false"
    />
  </div>
</template>

<style scoped>
.crumb {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  margin: 0 0 var(--space-3);
  font-size: var(--text-small);
  color: var(--ink-mute);
}
.pin-flag {
  font-family: var(--font-display);
  color: var(--terra-signal-ink);
  border: var(--grid-rule) solid currentColor;
  padding: 0 6px;
  letter-spacing: 0.1em;
}
.verdict-line {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: var(--space-3);
  margin: 0 0 var(--space-3);
}
.verdict {
  font-family: var(--font-display);
  font-size: var(--text-lead);
  letter-spacing: 0.08em;
  padding: 0 var(--space-2);
  border-block-end: 3px double currentColor;
}
.verdict-不实 {
  color: var(--terra-critical);
}
.verdict-误导 {
  color: var(--anno-gold);
}
.verdict-部分属实 {
  color: var(--anno-indigo);
}
.verdict-存疑,
.verdict-none {
  color: var(--ink-mute);
}
.src-line {
  font-size: var(--text-small);
  color: var(--ink-mute);
}
.tag-row {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-1);
  margin: 0;
}
.tagchip {
  min-height: 30px;
  display: inline-flex;
  align-items: center;
  padding: 0 var(--space-2);
  font-size: var(--text-small);
  text-decoration: none;
  color: var(--ink-soft);
  background: var(--paper-deep);
  border: var(--grid-rule) solid var(--rule-quiet);
  border-radius: var(--control-radius);
}
.tagchip:hover {
  border-color: var(--rule-firm);
  color: var(--terra-ink);
}
.tagchip:focus-visible {
  outline: var(--focus-ring) solid var(--terra-ink);
  outline-offset: 2px;
}

.dossier {
  margin: var(--space-5) 0;
  border: var(--grid-rule) solid var(--rule-firm);
  border-inline-start: 4px solid var(--rule-firm);
  background: var(--paper-deep);
  padding: var(--space-3) var(--space-4);
}
.dossier h2 {
  margin: 0 0 var(--space-2);
}
.dossier dl {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(11rem, 1fr));
  gap: var(--space-2) var(--space-4);
  margin: 0;
}
.dossier dt {
  font-size: var(--text-micro);
  letter-spacing: 0.12em;
  color: var(--ink-mute);
}
.dossier dd {
  margin: 0;
  font-family: var(--font-display);
  font-size: var(--text-small);
}
.dossier dd[data-overdue='true'] {
  color: var(--terra-signal-ink);
  font-weight: 700;
}

.slip-list {
  list-style: none;
  margin: var(--space-3) 0 0;
  padding: 0;
  display: grid;
  gap: var(--space-2);
}
.slip-row {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  gap: var(--space-3);
  align-items: center;
}
.slip-no {
  font-family: var(--font-mono);
  font-size: var(--text-micro);
  color: var(--ink-mute);
}
.slip-main {
  min-width: 0;
}
.slip-meta {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-3);
  margin: 2px 0 0;
  font-size: var(--text-micro);
  color: var(--ink-mute);
}
.slip-thumb {
  inline-size: 56px;
  block-size: 56px;
  object-fit: cover;
  border: var(--grid-rule) solid var(--rule-quiet);
}

.decision {
  margin-block-start: var(--space-6);
  padding-block-start: var(--space-4);
  border-block-start: var(--frame-rule) solid var(--rule-firm);
}
.decision-note {
  margin: var(--space-3) 0 0;
  font-size: var(--text-small);
  color: var(--ink-mute);
}
.seal-mark {
  display: inline-grid;
  place-items: center;
  inline-size: 1.6em;
  block-size: 1.6em;
  border: 1.5px solid currentColor;
  border-radius: var(--control-radius);
  font-family: var(--font-display);
  font-size: 0.8em;
}
.list-error {
  color: var(--terra-critical);
  border: var(--grid-rule) solid currentColor;
  padding: var(--space-3);
}
@media (max-width: 620px) {
  .slip-row {
    grid-template-columns: auto minmax(0, 1fr);
  }
  .slip-thumb {
    grid-column: 2;
    inline-size: 100%;
    block-size: 120px;
  }
}
</style>
