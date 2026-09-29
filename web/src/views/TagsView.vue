<script setup>
import { computed, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { api } from '../api/client.js';
import { useCatalogStore } from '../stores/catalog.js';

const catalog = useCatalogStore();
const router = useRouter();

const term = ref('');
const suggest = ref([]);
const loading = ref(false);
let timer = null;

const all = computed(() => catalog.tags);
const grouped = computed(() => {
  const buckets = new Map();
  for (const tag of all.value) {
    const key = tag.name.slice(0, 1).toUpperCase();
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(tag);
  }
  return [...buckets.entries()].sort((a, b) => a[0].localeCompare(b[0]));
});

async function lookup() {
  clearTimeout(timer);
  timer = setTimeout(async () => {
    if (!term.value.trim()) {
      suggest.value = [];
      return;
    }
    loading.value = true;
    try {
      const data = await api.get(`/api/tags?q=${encodeURIComponent(term.value.trim())}&limit=30`);
      suggest.value = data.items;
    } finally {
      loading.value = false;
    }
  }, 220);
}

onMounted(() => {
  if (!all.value.length) catalog.loadTags();
});

async function open(tag) {
  await router.push({ name: 'home', query: { tag } });
}
</script>

<template>
  <div class="sheet-inner">
    <header class="sheet-head">
      <h1 class="sheet-title">话题索引</h1>
      <div class="sheet-title-rule" aria-hidden="true"></div>
      <p class="sheet-lead">
        话题标签来自每条档案的「谣言相关话题」，用于向量式检索：命中越多档案的话题排在越前。
      </p>
    </header>

    <div class="pane">
      <label class="field">
        <span class="field-label">按话题名查找</span>
        <input
          v-model="term"
          class="paper-input"
          type="search"
          placeholder="输入两字以上，如：辐射、食品安全"
          autocomplete="off"
          @input="lookup"
        />
      </label>

      <div v-if="term.trim()" class="paper-progress" :aria-busy="loading ? 'true' : 'false'">
        <span class="micro-label">联想结果 {{ suggest.length }} 条</span>
        <progress v-if="loading" indeterminate max="1">查询中</progress>
        <ul v-else class="suggest-list">
          <li v-for="tag in suggest" :key="tag.name">
            <button class="tagline" type="button" @click="open(tag.name)">
              <span>{{ tag.name }}</span>
              <span class="tabular">{{ tag.count }} 条</span>
            </button>
          </li>
          <li v-if="!suggest.length" class="field-hint">无匹配话题。</li>
        </ul>
      </div>
    </div>

    <section v-for="[letter, tags] in grouped" :key="letter" class="group">
      <h2 class="group-head">
        <span class="group-letter">{{ letter }}</span>
        <span class="micro-label">{{ tags.length }} 个话题</span>
      </h2>
      <ul class="tag-grid">
        <li v-for="tag in tags" :key="tag.name">
          <button class="tagline" type="button" @click="open(tag.name)">
            <span>{{ tag.name }}</span>
            <span class="tabular">{{ tag.count }}</span>
          </button>
        </li>
      </ul>
    </section>

    <p v-if="!all.length" class="field-hint">尚无话题，先建立一条带话题的档案。</p>
  </div>
</template>

<style scoped>
.group {
  margin-block-end: var(--space-5);
}
.group-head {
  display: flex;
  align-items: baseline;
  gap: var(--space-3);
  font-size: var(--text-body);
  border-block-end: var(--grid-rule) solid var(--rule-firm);
  padding-block-end: var(--space-2);
  margin-block-end: var(--space-3);
}
.group-letter {
  font-family: var(--font-display);
  font-size: var(--text-lead);
  color: var(--terra-signal-ink);
}
.tag-grid {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(13rem, 1fr));
  gap: var(--space-2);
}
.suggest-list {
  list-style: none;
  margin: var(--space-2) 0 0;
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
  transition: border-color var(--dur-select) var(--ease-archive),
    translate var(--dur-select) var(--ease-archive);
}
.tagline:hover {
  border-inline-start-color: var(--rule-firm);
  translate: 2px 0;
}
.tagline:active {
  translate: 2px 1px;
}
.tagline:focus-visible {
  outline: var(--focus-ring) solid var(--terra-ink);
  outline-offset: 2px;
}
.tagline .tabular {
  color: var(--ink-mute);
  font-variant-numeric: tabular-nums;
}
</style>
