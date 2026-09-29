<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import PostCard from '../components/cards/PostCard.vue';
import WaterfallGrid from '../components/cards/WaterfallGrid.vue';
import { useCatalogStore } from '../stores/catalog.js';
import { useUiStore } from '../stores/ui.js';

const catalog = useCatalogStore();
const ui = useUiStore();
const route = useRoute();
const router = useRouter();

const showCovers = ref(true);
const RATINGS = ['不实', '误导', '部分属实', '存疑'];

const sentinel = ref(null);
let observer = null;

const cards = computed(() => catalog.items);
const featured = computed(() => catalog.items.find((item) => item.pinned) || null);
const rest = computed(() => catalog.items.filter((item) => !item.pinned));

const activeTag = computed(() => String(route.query.tag || ''));
const activeQuery = computed(() => String(route.query.q || ''));
const activeRating = computed(() => String(route.query.rating || ''));

const filtered = computed(() => Boolean(activeTag.value || activeQuery.value || activeRating.value));

function syncFromRoute() {
  catalog.setFilter({
    tag: activeTag.value,
    q: activeQuery.value,
    rating: activeRating.value,
  });
}

async function applyFilter(next) {
  const query = { ...route.query, ...next };
  for (const [key, value] of Object.entries(query)) if (!value) delete query[key];
  await router.push({ name: 'home', query });
}

async function clearFilters() {
  await router.push({ name: 'home' });
}

watch(() => route.query, syncFromRoute, { deep: true });

onMounted(() => {
  syncFromRoute();
  if (typeof IntersectionObserver !== 'undefined') {
    observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting) && catalog.hasMore && !catalog.loading) {
          catalog.loadList();
        }
      },
      { rootMargin: '480px 0px' }
    );
    if (sentinel.value) observer.observe(sentinel.value);
  }
});

onBeforeUnmount(() => observer?.disconnect());

watch(sentinel, (el) => {
  observer?.disconnect();
  if (el && observer) observer.observe(el);
});
</script>

<template>
  <div class="sheet-inner">
    <header class="sheet-head">
      <h1 class="sheet-title">卷首 · 辟谣档案</h1>
      <div class="sheet-title-rule" aria-hidden="true"></div>
      <p class="sheet-lead">
        每条档案以<b>谣言 ↔ 辟谣</b>双栏对勘呈现，重点处用朱砂圈划标出，材料源逐条登记出处与采集时刻。
      </p>
      <p class="sheet-meta">
        <span>在档 <b class="tabular">{{ catalog.total }}</b> 条</span>
        <span>话题 <b class="tabular">{{ catalog.stats.tagged }}</b> 个</span>
        <span>材料源 <b class="tabular">{{ catalog.stats.sources }}</b> 条</span>
        <span v-if="featured">当前置顶：{{ featured.title }}</span>
      </p>
    </header>

    <section class="toolbar" aria-label="档案筛选">
      <label class="paper-select-inline">
        <span class="micro-label">结论</span>
        <select
          class="paper-select"
          :value="activeRating"
          aria-label="按结论判定筛选"
          @change="applyFilter({ rating: $event.target.value })"
        >
          <option value="">全部判定</option>
          <option v-for="item in RATINGS" :key="item" :value="item">{{ item }}</option>
        </select>
      </label>

      <label class="paper-check">
        <input v-model="showCovers" type="checkbox" />
        <span>显示插图</span>
      </label>

      <button v-if="filtered" class="paper-btn btn-quiet" type="button" @click="clearFilters">
        清除筛选
      </button>

      <span class="toolbar-spacer" aria-hidden="true"></span>
      <span class="micro-label">共 {{ catalog.total }} 条 · 已载 {{ cards.length }} 条</span>
    </section>

    <nav v-if="catalog.tags.length" class="tagstrip" aria-label="话题快速筛选">
      <button
        class="tagchip"
        :class="{ 'tagchip--on': !activeTag }"
        type="button"
        @click="applyFilter({ tag: '' })"
      >
        全部话题
      </button>
      <button
        v-for="tag in catalog.tags.slice(0, 18)"
        :key="tag.name"
        class="tagchip"
        :class="{ 'tagchip--on': activeTag === tag.name }"
        type="button"
        :aria-pressed="activeTag === tag.name"
        @click="applyFilter({ tag: tag.name })"
      >
        {{ tag.name }}<span class="tabular tag-count">{{ tag.count }}</span>
      </button>
    </nav>

    <p v-if="catalog.listError" class="list-error" role="alert">{{ catalog.listError }}</p>

    <div v-if="featured" class="featured-wrap">
      <PostCard :item="{ ...featured, cover: showCovers ? featured.cover : '' }" featured />
    </div>

    <div
      class="list-region"
      :aria-busy="catalog.loading ? 'true' : 'false'"
      :aria-live="catalog.loading ? 'polite' : undefined"
    >
      <WaterfallGrid v-if="rest.length" :items="rest" :min-width="ui.density">
        <template #default="{ item }">
          <PostCard :item="{ ...item, cover: showCovers ? item.cover : '' }" />
        </template>
      </WaterfallGrid>

      <p v-else-if="!catalog.loading && !cards.length" class="empty-note">
        未检索到符合条件的档案。可清除筛选，或<RouterLink :to="{ name: 'edit' }">新增一条图文</RouterLink>。
      </p>

      <div v-if="catalog.loading" class="paper-progress load-progress">
        <span class="micro-label">正在载入下一批档案</span>
        <progress indeterminate max="1">载入中</progress>
      </div>

      <div ref="sentinel" class="sentinel" aria-hidden="true"></div>
      <p v-if="!catalog.hasMore && cards.length" class="end-note">— 已至卷末 —</p>
    </div>
  </div>
</template>

<style scoped>
.sheet-lead {
  margin: 0 0 var(--space-3);
  color: var(--ink-soft);
  font-size: var(--text-lead);
  max-inline-size: 46rem;
}
.sheet-lead b {
  color: var(--terra-signal-ink);
}
.sheet-meta b {
  color: var(--terra-ink);
}

.toolbar {
  margin-block-end: var(--space-4);
}
.toolbar-spacer {
  flex: 1;
}
.paper-select-inline {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
}
.toolbar .paper-select {
  width: auto;
  min-inline-size: 8.5rem;
  min-height: 34px;
  padding-block: 2px;
  border: var(--grid-rule) solid var(--rule-firm);
  background-color: var(--paper-leaf);
}

.tagstrip {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-1);
  margin-block-end: var(--space-5);
}
.tagchip {
  display: inline-flex;
  align-items: baseline;
  gap: 4px;
  min-height: 30px;
  padding: 0 var(--space-2);
  background: var(--paper-leaf);
  border: var(--grid-rule) solid var(--rule-quiet);
  border-radius: var(--control-radius);
  color: var(--ink-soft);
  font-size: var(--text-small);
  cursor: pointer;
  transition: border-color var(--dur-select) var(--ease-archive),
    translate var(--dur-select) var(--ease-archive);
}
.tagchip:hover {
  border-color: var(--rule-firm);
}
.tagchip:active {
  translate: 0 1px;
}
.tagchip--on {
  border-color: var(--terra-ink);
  border-inline-start: 4px solid var(--terra-signal);
  color: var(--terra-ink);
  font-weight: 700;
}
.tagchip:focus-visible {
  outline: var(--focus-ring) solid var(--terra-ink);
  outline-offset: 2px;
}
.tag-count {
  font-size: var(--text-micro);
  color: var(--ink-mute);
}

.featured-wrap {
  margin-block-end: var(--space-5);
}
.list-region {
  min-height: 24rem;
}
.sentinel {
  block-size: 1px;
}
.load-progress {
  margin-block: var(--space-4);
}
.load-progress progress {
  block-size: 6px;
}
.end-note,
.empty-note {
  text-align: center;
  color: var(--ink-mute);
  font-family: var(--font-display);
  letter-spacing: 0.2em;
  margin-block-start: var(--space-5);
}
.empty-note {
  letter-spacing: normal;
  border: var(--grid-rule) dashed var(--rule-firm);
  padding: var(--space-6);
}
.list-error {
  color: var(--terra-critical);
  border: var(--grid-rule) solid currentColor;
  padding: var(--space-3);
}
</style>
