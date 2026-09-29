<script setup>
import { computed, onMounted, ref, watch } from 'vue';
import { RouterLink, useRoute, useRouter } from 'vue-router';
import { api, describeError } from '../api/client.js';
import { useCatalogStore } from '../stores/catalog.js';

const catalog = useCatalogStore();
const route = useRoute();
const router = useRouter();

const term = ref(String(route.query.q || ''));
const results = ref([]);
const loading = ref(false);
const error = ref('');
const searched = ref(false);

const maxScore = computed(() => Math.max(0.0001, ...results.value.map((r) => r.score || 0)));

function ratio(item) {
  return Math.round(((item.score || 0) / maxScore.value) * 100);
}

async function run() {
  const q = term.value.trim();
  error.value = '';
  if (!q) {
    results.value = [];
    searched.value = false;
    return;
  }
  loading.value = true;
  searched.value = true;
  try {
    const data = await api.get(`/api/search?q=${encodeURIComponent(q)}&limit=30`);
    results.value = data.items;
    await router.replace({ name: 'search', query: { q } });
  } catch (err) {
    error.value = describeError(err);
  } finally {
    loading.value = false;
  }
}

onMounted(() => {
  if (term.value.trim()) run();
});

watch(
  () => route.query.q,
  (value) => {
    const next = String(value || '');
    if (next !== term.value) {
      term.value = next;
      run();
    }
  }
);
</script>

<template>
  <div class="sheet-inner">
    <header class="sheet-head">
      <h1 class="sheet-title">检索</h1>
      <div class="sheet-title-rule" aria-hidden="true"></div>
      <p class="sheet-lead">
        检索走后端常驻内存索引：中文按单字与相邻二字组切分，标题与话题加权高于正文，支持前缀与西文模糊。
      </p>
    </header>

    <form class="search-line" role="search" @submit.prevent="run">
      <label class="sr-only" for="search-input">检索词</label>
      <input
        id="search-input"
        v-model="term"
        class="paper-input"
        type="search"
        placeholder="如：路由器辐射 / 隔夜 / 不锈钢"
        autocomplete="off"
      />
      <button class="paper-btn seal-press" type="submit" :disabled="loading">
        {{ loading ? '检索中…' : '检索' }}
      </button>
      <RouterLink class="paper-btn btn-quiet" :to="{ name: 'home', query: { q: term } }">
        以列表方式查看
      </RouterLink>
    </form>

    <p v-if="error" class="list-error" role="alert">{{ error }}</p>

    <div class="paper-progress" :aria-busy="loading ? 'true' : 'false'">
      <span class="micro-label">
        {{ searched ? `命中 ${results.length} 条` : '输入检索词后回车' }}
      </span>
      <progress v-if="loading" indeterminate max="1">检索中</progress>
    </div>

    <ol class="result-list">
      <li v-for="item in results" :key="item.id">
        <RouterLink class="result" :to="{ name: 'post', params: { id: item.id } }">
          <div class="result-head">
            <h2 class="result-title">{{ item.title }}</h2>
            <span v-if="item.rating" class="result-rating">{{ item.rating }}</span>
          </div>
          <p class="result-excerpt">{{ item.excerpt }}</p>
          <div class="result-foot">
            <span class="score-bar" :aria-label="`相关度 ${ratio(item)}%`">
              <i :style="{ inlineSize: `${ratio(item)}%` }"></i>
            </span>
            <span class="tabular score-num">相关度 {{ ratio(item) }}%</span>
            <span v-for="tag in item.tags.slice(0, 4)" :key="tag" class="slip-tag">{{ tag }}</span>
          </div>
        </RouterLink>
      </li>
    </ol>

    <p v-if="searched && !results.length && !loading" class="field-hint">
      无匹配档案。可换用更短的词，或到
      <RouterLink :to="{ name: 'tags' }">话题索引</RouterLink>按话题浏览。
    </p>
  </div>
</template>

<style scoped>
.search-line {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
  margin-block-end: var(--space-4);
}
.search-line .paper-input {
  flex: 1 1 14rem;
  border: var(--control-stroke) solid var(--rule-firm);
  padding: var(--space-2) var(--space-3);
}
.result-list {
  list-style: none;
  margin: var(--space-4) 0 0;
  padding: 0;
  display: grid;
  gap: var(--space-3);
}
.result {
  display: block;
  padding: var(--space-4);
  background: var(--paper-leaf);
  border: var(--grid-rule) solid var(--rule-firm);
  border-inline-start: 4px solid var(--rule-quiet);
  border-radius: var(--control-radius);
  text-decoration: none;
  color: var(--terra-ink);
  transition: border-color var(--dur-select) var(--ease-archive),
    translate var(--dur-select) var(--ease-archive);
}
.result:hover {
  border-inline-start-color: var(--terra-signal);
  translate: 2px 0;
}
.result:focus-visible {
  outline: var(--focus-ring) solid var(--terra-ink);
  outline-offset: 3px;
}
.result-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: var(--space-3);
}
.result-title {
  font-size: var(--text-lead);
}
.result-rating {
  font-family: var(--font-display);
  font-size: var(--text-small);
  color: var(--terra-critical);
  border: var(--grid-rule) solid currentColor;
  padding: 0 6px;
  white-space: nowrap;
}
.result-excerpt {
  margin: var(--space-2) 0 0;
  font-size: var(--text-small);
  color: var(--ink-soft);
}
.result-foot {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  margin-block-start: var(--space-3);
  padding-block-start: var(--space-2);
  border-block-start: var(--grid-rule) solid var(--rule-quiet);
}
.score-bar {
  position: relative;
  inline-size: 7rem;
  block-size: 6px;
  background: var(--paper-deep);
  border: var(--grid-rule) solid var(--rule-quiet);
}
.score-bar i {
  display: block;
  block-size: 100%;
  background: var(--terra-signal);
}
.score-num {
  font-size: var(--text-micro);
  color: var(--ink-mute);
}
.list-error {
  color: var(--terra-critical);
  border: var(--grid-rule) solid currentColor;
  padding: var(--space-3);
}
</style>
