<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useLibraryStore } from '../stores/library.js';
import EpubHtml from '../components/paper/EpubHtml.vue';

const route = useRoute();
const router = useRouter();
const library = useLibraryStore();

const code = ref('');
const busy = ref(false);
const pendingAnchor = ref('');

const bookId = computed(() => String(route.params.id || ''));
const chapter = computed(() => Number(route.query.c) || 0);
const part = computed(() => Number(route.query.p) || 1);
const wantWhole = computed(() => route.query.m === 'all');
const meta = computed(() => library.reader);
const page = computed(() => library.page);
const book = computed(() => meta.value?.book || {});
const chapters = computed(() => meta.value?.chapters || []);
const total = computed(() => chapters.value.length || 1);
const splitMb = computed(() => Math.round((meta.value?.limits?.splitBytes || 0) / 1024 / 1024) || 10);

const human = (bytes) =>
  bytes > 1048576 ? `${(bytes / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;

const percent = computed(() => {
  if (page.value?.mode === 'whole') return 100;
  return Math.round(((chapter.value + 1) / total.value) * 100);
});

const position = computed(() => {
  if (page.value?.mode === 'whole') return '全本一册';
  const partText = page.value?.parts > 1 ? ` · 小节 ${page.value.part}/${page.value.parts}` : '';
  return `第 ${(page.value?.chapterIndex ?? 0) + 1} / ${total.value} 章${partText}`;
});

async function load() {
  if (!library.unlocked || !bookId.value) return;
  if (!meta.value || meta.value.book.id !== bookId.value) await library.openReader(bookId.value);
  if (!meta.value) return;
  if (wantWhole.value) {
    if (page.value?.mode !== 'whole') await library.openWhole(bookId.value);
    return;
  }
  await library.openPage(bookId.value, chapter.value, part.value);
  await jumpToAnchor();
}

/** 包内跨章链接的目标锚点：等新页真正渲染出来再滚，否则找不到元素 */
async function jumpToAnchor() {
  const id = pendingAnchor.value;
  pendingAnchor.value = '';
  await nextTick();
  if (id) document.getElementById(id)?.scrollIntoView({ block: 'start' });
  else window.scrollTo(0, 0);
}

function onBodyClick(event) {
  const link = event.target instanceof Element ? event.target.closest('a[href]') : null;
  if (!link) return;
  const href = link.getAttribute('href') || '';
  if (!href.startsWith(`/library/${bookId.value}/read`)) return;
  event.preventDefault();
  const url = new URL(href, window.location.origin);
  const target = Number(url.searchParams.get('c')) || 0;
  const anchor = url.hash.slice(1);
  if (target === chapter.value && page.value?.mode !== 'whole') {
    if (anchor) document.getElementById(anchor)?.scrollIntoView({ block: 'start' });
    return;
  }
  pendingAnchor.value = anchor;
  router.push({ path: `/library/${bookId.value}/read`, query: { c: target, p: 1 } });
}

function go(c, p = 1) {
  router.push({ path: `/library/${bookId.value}/read`, query: { c, p } });
}

function step(target) {
  if (!target) return;
  go(target.c, target.p);
}

function switchMode(all) {
  if (all) router.push({ path: `/library/${bookId.value}/read`, query: { m: 'all' } });
  else go(0, 1);
}

function onKey(event) {
  if (event.metaKey || event.ctrlKey || event.altKey) return;
  if (event.target instanceof HTMLElement && /^(INPUT|TEXTAREA|SELECT)$/.test(event.target.tagName)) return;
  if (page.value?.mode === 'whole') return;
  if (event.key === 'ArrowRight') step(page.value?.nav?.next);
  if (event.key === 'ArrowLeft') step(page.value?.nav?.prev);
}

async function submitUnlock() {
  busy.value = true;
  await library.unlock(code.value);
  code.value = '';
  busy.value = false;
  await load();
}

onMounted(async () => {
  await library.load();
  await load();
  window.addEventListener('keydown', onKey);
});

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKey);
  library.closeReader();
});

watch([bookId], () => library.closeReader());
watch([chapter, part, wantWhole, () => library.unlocked], load);
watch(meta, (value) => {
  if (value) document.title = `${value.book.title || '在线阅览'} · 辨妄阁洛琪希图书馆镜像`;
});
</script>

<template>
  <div class="sheet-inner">
    <header class="sheet-head">
      <h1 class="sheet-title">{{ book.title || '在线阅览' }}</h1>
      <div class="sheet-title-rule" aria-hidden="true"></div>
      <p class="sheet-lead">
        镜像册的<b>卷面阅览</b>：与取书同一道口令，正文按<b>章节分页</b>逐页下发，
        整本从不进浏览器内存；{{ splitMb }}MB 以上的书只此一种读法。
      </p>
      <p v-if="meta" class="micro-label">
        {{ human(meta.book.bytes) }} · {{ meta.chapters.length }} 章 · 单页上限
        <span class="tabular">{{ Math.round(meta.limits.pageBytes / 1024) }}</span> KB · 令牌至
        <span class="tabular">{{ library.grant ? new Date(library.grant.expiresAt).toLocaleTimeString('zh-CN', { hour12: false }) : '—' }}</span>
      </p>
    </header>

    <section v-if="!library.unlocked" class="pane gate" aria-label="口令解锁">
      <div class="pane-head">
        <h2 class="pane-title">入馆口令</h2>
        <span class="micro-label">阅览与取书共用一枚短时效令牌</span>
      </div>
      <form class="row" @submit.prevent="submitUnlock">
        <label class="field grow">
          <span class="field-label">口令</span>
          <input v-model="code" class="paper-input" type="password" autocomplete="off" maxlength="40" placeholder="向馆方索取口令后可直接阅览" />
        </label>
        <button class="paper-btn seal-press" type="submit" :disabled="busy || !code" :aria-busy="busy ? 'true' : 'false'">验印入馆</button>
      </form>
      <p v-if="library.readError" class="field-error" role="alert">{{ library.readError }}</p>
      <p class="field-hint">口令错误、被停用或已到期都会回到此处；连错若干次会按 IP 冷却。</p>
    </section>

    <p v-else-if="library.readError && !meta" class="field-error" role="alert">{{ library.readError }}</p>
    <p v-else-if="library.reading && !page" class="field-hint" aria-busy="true">正在拆页…</p>

    <div v-if="library.unlocked && meta" class="reader-grid">
      <nav class="toc" aria-label="章节目录">
        <div class="pane-head">
          <h2 class="pane-title">章节目录</h2>
          <span class="micro-label">{{ meta.chapters.length }} 章</span>
        </div>
        <ul>
          <li v-for="item in meta.chapters" :key="item.index">
            <a
              v-if="page?.mode === 'whole'"
              class="toc-link"
              :class="{ 'is-now': false }"
              :href="`#c${item.index}`"
            >{{ item.title }}</a>
            <button
              v-else
              class="toc-link"
              type="button"
              :class="{ 'is-now': item.index === page?.chapterIndex }"
              :aria-current="item.index === page?.chapterIndex ? 'page' : undefined"
              @click="go(item.index, 1)"
            >{{ item.title }}</button>
          </li>
        </ul>
        <div class="toc-mode">
          <button
            class="paper-btn btn-quiet"
            type="button"
            :disabled="meta.splitRequired || page?.mode === 'whole'"
            :title="meta.splitRequired ? `超过 ${splitMb}MB 的书只允许分页阅览` : '合为一页通读'"
            @click="switchMode(true)"
          >全本通读</button>
          <button class="paper-btn btn-quiet" type="button" :disabled="page?.mode !== 'whole'" @click="switchMode(false)">回到分页</button>
        </div>
        <p v-if="meta.splitRequired" class="split-note" role="note">
          本书 {{ human(meta.book.bytes) }}，超过 {{ splitMb }}MB：已按章节拆成
          <b>{{ meta.chapters.length }}</b> 个可阅览网页，不提供整本渲染。
        </p>
      </nav>

      <article class="reading-sheet">
        <header class="reading-head">
          <h2 class="reading-title">{{ page?.mode === 'whole' ? book.title : page?.chapterTitle || '—' }}</h2>
          <span class="micro-label tabular">{{ position }}</span>
        </header>
        <div class="reading-rule" aria-hidden="true"></div>
        <p v-if="library.readError" class="field-error" role="alert">{{ library.readError }}</p>
        <div v-if="page?.html" class="page-host" @click="onBodyClick">
          <EpubHtml :html="page.html" />
        </div>
        <p v-else-if="page?.mode !== 'whole'" class="field-hint">本章没有可显示的正文（图形若为 SVG 等类型会被挡下）。</p>

        <nav class="page-nav" aria-label="翻页">
          <button class="paper-btn" type="button" :disabled="!page?.nav?.prev" @click="step(page?.nav?.prev)">上一页</button>
          <span class="progress" role="img" :aria-label="`阅览进度 ${percent}%`">
            <i :style="{ inlineSize: `${percent}%` }"></i>
          </span>
          <button class="paper-btn seal-press" type="button" :disabled="!page?.nav?.next" @click="step(page?.nav?.next)">下一页</button>
        </nav>
        <p class="field-hint">键盘 ← / → 可翻页；正文中的插图按需加载。</p>
      </article>
    </div>
  </div>
</template>

<style scoped>
.gate .row {
  align-items: flex-end;
}
.grow {
  flex: 1 1 12rem;
}
.reader-grid {
  display: grid;
  grid-template-columns: minmax(11rem, 15rem) minmax(0, 1fr);
  gap: var(--space-5);
  align-items: start;
}
.toc {
  position: sticky;
  inset-block-start: var(--space-4);
  background: var(--paper-leaf);
  border: var(--grid-rule) solid var(--rule-quiet);
  border-radius: var(--control-radius);
  padding: var(--space-3);
}
.toc ul {
  list-style: none;
  margin: var(--space-2) 0 0;
  padding: 0;
  display: grid;
  gap: var(--space-1);
  max-block-size: 52vh;
  overflow-y: auto;
}
.toc-link {
  display: block;
  inline-size: 100%;
  text-align: start;
  background: none;
  border: 0;
  border-inline-start: 2px solid var(--rule-quiet);
  padding: 3px var(--space-2);
  font-family: var(--font-display);
  font-size: var(--text-small);
  color: var(--ink-soft);
  cursor: pointer;
  text-decoration: none;
}
.toc-link:hover {
  border-inline-start-color: var(--rule-firm);
  color: var(--terra-ink);
}
.toc-link:focus-visible {
  outline: var(--focus-ring) solid var(--terra-ink);
  outline-offset: 2px;
}
.toc-link.is-now {
  border-inline-start-color: var(--terra-signal-ink);
  color: var(--terra-ink);
  background: var(--paper-deep);
}
.toc-mode {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-1);
  margin-block-start: var(--space-3);
}
.split-note {
  margin: var(--space-3) 0 0;
  font-size: var(--text-micro);
  color: var(--ink-mute);
  border-block-start: var(--grid-rule) dashed var(--rule-quiet);
  padding-block-start: var(--space-2);
}
.reading-sheet {
  background: var(--paper-leaf);
  border: var(--grid-rule) solid var(--rule-quiet);
  border-radius: var(--control-radius);
  padding: var(--space-6) clamp(var(--space-4), 5vw, var(--space-8));
  box-shadow: var(--paper-shadow);
}
.reading-head {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  justify-content: space-between;
  gap: var(--space-2);
}
.reading-title {
  margin: 0;
  font-family: var(--font-display);
  font-size: var(--text-title);
}
.reading-rule {
  block-size: 0;
  border-block-end: var(--grid-rule) solid var(--rule-firm);
  margin: var(--space-2) 0 var(--space-5);
}
.page-nav {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  margin-block-start: var(--space-6);
  padding-block-start: var(--space-4);
  border-block-start: var(--grid-rule) solid var(--rule-quiet);
}
.progress {
  flex: 1 1 6rem;
  block-size: 4px;
  background: var(--rule-quiet);
  overflow: hidden;
}
.progress i {
  display: block;
  block-size: 100%;
  background: var(--terra-signal-ink);
  transition: inline-size var(--dur-reveal) var(--ease-archive);
}
@media (max-width: 56rem) {
  .reader-grid {
    grid-template-columns: minmax(0, 1fr);
  }
  .toc {
    position: static;
  }
  .toc ul {
    max-block-size: 12rem;
  }
}
</style>
