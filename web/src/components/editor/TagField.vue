<script setup>
import { computed, ref } from 'vue';
import { api } from '../../api/client.js';
import { useCatalogStore } from '../../stores/catalog.js';

const props = defineProps({
  modelValue: { type: Array, default: () => [] },
  max: { type: Number, default: 20 },
});
const emit = defineEmits(['update:modelValue']);

const catalog = useCatalogStore();
const draft = ref('');
const suggest = ref([]);
const error = ref('');
let timer = null;

const tags = computed(() => props.modelValue || []);
const left = computed(() => props.max - tags.value.length);

function add(raw) {
  const value = String(raw || '')
    .trim()
    .replace(/\s+/g, ' ')
    .slice(0, 24);
  error.value = '';
  if (!value) return;
  if (tags.value.includes(value)) {
    error.value = `话题「${value}」已存在`;
    return;
  }
  if (tags.value.length >= props.max) {
    error.value = `每条档案最多 ${props.max} 个话题`;
    return;
  }
  // 就地追加：粘贴多个话题时连续调用 add，不能基于未回流的旧 props 重建
  tags.value.push(value);
  emit('update:modelValue', [...tags.value]);
  draft.value = '';
  suggest.value = [];
}

function removeAt(index) {
  tags.value.splice(index, 1);
  emit('update:modelValue', [...tags.value]);
}

function onInput() {
  // 逗号/空格分隔允许一次粘贴多个话题
  const parts = draft.value.split(/[,，;；]/).map((part) => part.trim()).filter(Boolean);
  if (parts.length > 1) {
    parts.forEach(add);
    draft.value = '';
    return;
  }
  clearTimeout(timer);
  timer = setTimeout(async () => {
    if (draft.value.trim().length < 1) {
      suggest.value = [];
      return;
    }
    try {
      const data = await api.get(`/api/tags?q=${encodeURIComponent(draft.value.trim())}&limit=8`);
      suggest.value = data.items.filter((item) => !tags.value.includes(item.name));
    } catch {
      suggest.value = [];
    }
  }, 200);
}

function onKeydown(event) {
  if (event.key === 'Enter' || event.key === ',' || event.key === '，') {
    event.preventDefault();
    add(draft.value);
  } else if (event.key === 'Backspace' && !draft.value && tags.value.length) {
    removeAt(tags.value.length - 1);
  }
}
</script>

<template>
  <div class="tag-field">
    <div class="tag-input-row">
      <label class="sr-only" for="tag-input">新增话题标签</label>
      <input
        id="tag-input"
        v-model="draft"
        class="paper-input"
        type="text"
        :aria-describedby="error ? 'tag-error' : 'tag-hint'"
        :aria-invalid="error ? 'true' : 'false'"
        placeholder="输入话题后回车，可一次粘贴多个（逗号分隔）"
        autocomplete="off"
        @input="onInput"
        @keydown="onKeydown"
      />
      <button class="paper-btn" type="button" :disabled="left <= 0" @click="add(draft)">加入</button>
    </div>

    <p id="tag-hint" class="field-hint">
      话题用于向量检索，纯文本即可；剩余 {{ left }} 个名额。
      常用话题：
      <button
        v-for="preset in catalog.tags.slice(0, 6).map((t) => t.name).filter((name) => !tags.includes(name))"
        :key="preset"
        class="preset"
        type="button"
        @click="add(preset)"
      >
        + {{ preset }}
      </button>
    </p>
    <p v-if="error" id="tag-error" class="field-error" role="alert">{{ error }}</p>

    <ul v-if="tags.length" class="tag-list" aria-label="已加入的话题">
      <li v-for="(tag, index) in tags" :key="tag">
        <span class="tag-chip">
          {{ tag }}
          <button type="button" :aria-label="`移除话题 ${tag}`" @click="removeAt(index)">×</button>
        </span>
      </li>
    </ul>

    <ul v-if="suggest.length" class="suggest">
      <li v-for="item in suggest" :key="item.name">
        <button type="button" @click="add(item.name)">
          {{ item.name }}<span class="tabular">{{ item.count }}</span>
        </button>
      </li>
    </ul>
  </div>
</template>

<style scoped>
.tag-input-row {
  display: flex;
  gap: var(--space-2);
}
.tag-input-row .paper-input {
  flex: 1;
}
.tag-list {
  list-style: none;
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-1);
  margin: var(--space-3) 0 0;
  padding: 0;
}
.tag-chip {
  display: inline-flex;
  align-items: center;
  gap: var(--space-1);
  padding: 2px var(--space-2);
  background: var(--paper-deep);
  border: var(--grid-rule) solid var(--rule-firm);
  border-inline-start: 3px solid var(--terra-signal);
  border-radius: var(--control-radius);
  font-size: var(--text-small);
}
.tag-chip button {
  border: 0;
  background: none;
  cursor: pointer;
  color: var(--ink-mute);
  font-size: 1rem;
  line-height: 1;
  padding: 0 2px;
}
.tag-chip button:hover {
  color: var(--terra-critical);
}
.tag-chip button:focus-visible {
  outline: var(--focus-ring) solid var(--terra-ink);
  outline-offset: 1px;
}
.preset {
  border: 0;
  background: none;
  color: var(--ink-soft);
  cursor: pointer;
  text-decoration: underline;
  padding: 0 2px;
  font-size: inherit;
}
.preset:focus-visible {
  outline: var(--focus-ring) solid var(--terra-ink);
}
.suggest {
  list-style: none;
  margin: var(--space-2) 0 0;
  padding: 0;
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-1);
}
.suggest button {
  min-height: 28px;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 0 var(--space-2);
  background: var(--paper-leaf);
  border: var(--grid-rule) dashed var(--rule-firm);
  cursor: pointer;
  font-size: var(--text-small);
}
.suggest button:hover {
  border-style: solid;
}
.suggest .tabular {
  color: var(--ink-mute);
  font-size: var(--text-micro);
}
</style>
