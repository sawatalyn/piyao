<script setup>
import { computed, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import BrandMark from '../paper/BrandMark.vue';
import { useAuthStore } from '../../stores/auth.js';
import { useCatalogStore } from '../../stores/catalog.js';
import { useMenuStore } from '../../stores/menu.js';
import { useUiStore } from '../../stores/ui.js';

const route = useRoute();
const router = useRouter();
const auth = useAuthStore();
const catalog = useCatalogStore();
const menu = useMenuStore();
const ui = useUiStore();

const term = ref(route.query.q || '');
watch(
  () => route.query.q,
  (value) => {
    term.value = value || '';
  }
);

const marginState = computed(() => (ui.marginOpen ? 'expanded' : 'collapsed'));

async function submitSearch() {
  const q = term.value.trim();
  if (!q) {
    await router.push({ name: 'home' });
    return;
  }
  await router.push({ name: 'search', query: { q } });
}

async function toggleMargin() {
  ui.toggleMargin();
  if (window.matchMedia('(max-width: 1080px)').matches && !ui.marginOpen) {
    document.getElementById('margin-region')?.scrollIntoView({ block: 'nearest' });
  }
}

function isActive(path) {
  return path === '/' ? route.path === '/' : route.path.startsWith(path);
}

async function logout() {
  await auth.logout();
  await router.push({ name: 'home' });
}
</script>

<template>
  <header class="shell-head">
    <div class="head-bar">
      <!-- 签名控件一：批注栏开合（窄栏向内展开，不覆盖阅读面） -->
      <button
        class="margin-toggle"
        type="button"
        :aria-expanded="ui.marginOpen"
        aria-controls="margin-region"
        :data-state="marginState"
        @click="toggleMargin"
      >
        <span class="toggle-spine" aria-hidden="true">
          <i></i><i></i><i></i>
        </span>
        <span class="toggle-text">批注栏</span>
        <span class="toggle-state">{{ ui.marginOpen ? '已开' : '已合' }}</span>
      </button>

      <RouterLink class="brand" :to="{ name: 'home' }">
        <BrandMark class="brand-mark" />
        <span class="brand-text">
          <strong>辨妄阁</strong>
          <small>辟谣档案库</small>
        </span>
      </RouterLink>

      <div class="head-search">
        <form class="search-form" role="search" @submit.prevent="submitSearch">
          <label class="sr-only" for="global-search">按标题或话题检索档案</label>
          <input
            id="global-search"
            v-model="term"
            class="paper-input"
            type="search"
            name="q"
            placeholder="检索标题、话题标签或正文"
            autocomplete="off"
          />
          <button type="submit" title="检索">
            <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false">
              <circle cx="10.5" cy="10.5" r="6" fill="none" stroke="currentColor" stroke-width="2" />
              <path d="M15.5 15.5 L21 21" stroke="currentColor" stroke-width="2" fill="none" />
            </svg>
            <span class="sr-only">检索</span>
          </button>
        </form>
      </div>

      <div class="head-auth">
        <template v-if="auth.isAuthed">
          <RouterPath :to="{ name: 'home' }">
            <span class="who">{{ auth.user.displayName || auth.user.username }}</span>
          </RouterPath>
          <button class="paper-btn btn-quiet" type="button" @click="logout">登出</button>
        </template>
        <RouterLink v-else class="paper-btn" :to="{ name: 'login', query: { next: route.fullPath } }">
          登录
        </RouterLink>
      </div>
    </div>

    <!-- 卷首档案索引：可见模块由菜单编辑结果驱动 -->
    <nav class="archive-index" aria-label="档案索引">
      <ol>
        <li v-for="module in menu.indexModules" :key="module.moduleId">
          <RouterLink
            class="index-link"
            :to="{ name: module.name }"
            :aria-current="isActive(module.route) ? 'page' : undefined"
          >
            {{ module.label }}
            <span v-if="module.requiresAuth && !auth.isAuthed" class="index-lock">登录</span>
          </RouterLink>
        </li>
      </ol>
    </nav>
  </header>
</template>


<style scoped>
.margin-toggle {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  min-height: var(--control-min-h);
  padding: var(--space-2) var(--space-3);
  background: var(--paper-deep);
  border: var(--control-stroke) solid var(--rule-firm);
  border-radius: var(--control-radius);
  cursor: pointer;
  font-family: var(--font-display);
  font-size: var(--text-small);
  letter-spacing: 0.08em;
  transition: translate var(--dur-select) var(--ease-archive),
    border-color var(--dur-select) var(--ease-archive);
}
.margin-toggle:active {
  translate: 0 var(--press-distance);
}
.margin-toggle:focus-visible {
  outline: var(--focus-ring) solid var(--terra-ink);
  outline-offset: 2px;
}
.margin-toggle[data-state='expanded'] {
  border-color: var(--terra-ink);
}
.margin-toggle[data-state='expanded'] .toggle-state {
  color: var(--terra-signal-ink);
}
.toggle-spine {
  display: grid;
  gap: 3px;
  inline-size: 16px;
}
.toggle-spine i {
  display: block;
  block-size: 2px;
  background: var(--terra-ink);
  transition: inline-size var(--dur-select) var(--ease-archive);
}
.toggle-spine i:nth-child(1) {
  inline-size: 16px;
}
.toggle-spine i:nth-child(2) {
  inline-size: 11px;
}
.toggle-spine i:nth-child(3) {
  inline-size: 14px;
}
.margin-toggle[data-state='collapsed'] .toggle-spine i:nth-child(2) {
  inline-size: 16px;
}
.toggle-state {
  font-size: var(--text-micro);
  color: var(--ink-mute);
  letter-spacing: 0.12em;
}
.who {
  font-family: var(--font-display);
  font-size: var(--text-small);
  letter-spacing: 0.08em;
  color: var(--ink-soft);
  padding-inline-end: var(--space-2);
  border-inline-end: var(--grid-rule) solid var(--rule-quiet);
}
@media (max-width: 620px) {
  .toggle-text {
    display: none;
  }
}
</style>
