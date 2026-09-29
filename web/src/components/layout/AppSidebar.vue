<script setup>
import { computed } from 'vue';
import { RouterLink, useRoute } from 'vue-router';
import { useAuthStore } from '../../stores/auth.js';
import { useCatalogStore } from '../../stores/catalog.js';
import { useMenuStore } from '../../stores/menu.js';
import { useResourceStore } from '../../stores/resources.js';
import { useLibraryStore } from '../../stores/library.js';
import { useUiStore } from '../../stores/ui.js';

const route = useRoute();
const auth = useAuthStore();
const catalog = useCatalogStore();
const menu = useMenuStore();
const resources = useResourceStore();
const library = useLibraryStore();
const ui = useUiStore();

const densityLabel = computed(() => {
  if (ui.density <= 260) return '疏（窄卷面）';
  if (ui.density <= 320) return '中（常规卷面）';
  return '密（宽卷面）';
});

const currentTag = computed(() => (route.name === 'home' ? String(route.query.tag || '') : ''));

// 导轨只排前 12 个话题：按命中档案数降序，同数按名称排，末尾给全量索引入口
const topicRail = computed(() =>
  [...catalog.tags]
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'zh-CN'))
    .slice(0, 12)
);

const resourceRail = computed(() =>
  resources.groups
    .flatMap((group) => group.items.map((item) => ({ ...item, groupName: group.group })))
    .slice(0, 10)
);

/** 手工登记的链接渲染前再过一道协议白名单 */
const safeHref = (url) => (/^(https?:\/\/|\/)/i.test(String(url || '')) ? url : '');
</script>

<template>
  <aside id="margin-region" class="annotation-margin" aria-label="批注栏">
    <div class="margin-spine">
      <span class="vertical-label">批注栏</span>
      <span class="spine-count tabular">{{ catalog.tags.length }}</span>
    </div>

    <div class="margin-body">
      <section class="margin-section">
        <h2 class="margin-title">
          功能入口
          <span class="micro-label">Modules</span>
        </h2>
        <ul class="margin-nav">
          <li v-for="module in menu.marginModules" :key="module.moduleId">
            <RouterLink
              class="margin-link"
              :to="{ name: module.name }"
              :aria-current="route.name === module.name ? 'page' : undefined"
            >
              <span>{{ module.label }}</span>
              <span v-if="module.requiresAuth && !auth.isAuthed" class="micro-label">登录</span>
            </RouterLink>
          </li>
        </ul>
      </section>

      <section class="margin-section">
        <h2 class="margin-title">
          卷面
          <span class="micro-label">Reading</span>
        </h2>

        <label class="paper-range" for="density">
          <span>卡片宽度 <output>{{ ui.density }}px · {{ densityLabel }}</output></span>
          <input
            id="density"
            v-model.number="ui.density"
            type="range"
            min="240"
            max="420"
            step="20"
            aria-describedby="density-hint"
          />
          <span id="density-hint" class="field-hint">调整瀑布流单列最小宽度，即时生效</span>
        </label>

        <button
          class="paper-switch"
          type="button"
          role="switch"
          :aria-checked="ui.tone === 'night'"
          data-switch="tone"
          @click="ui.tone = ui.tone === 'night' ? 'day' : 'night'"
        >
          <span class="switch-track" aria-hidden="true"><span class="switch-knob"></span></span>
          <span>夜读纸面</span>
        </button>
      </section>

      <section class="margin-section">
        <h2 class="margin-title">
          辟谣话题
          <span class="micro-label">Topics</span>
        </h2>
        <p v-if="!catalog.tags.length" class="field-hint">尚无话题，档案登记话题后自动汇总。</p>
        <!-- 签名控件二：话题记录条导轨，选中话题留印朱记录边 -->
        <nav class="slip-rail" aria-label="辟谣话题标签列表">
          <RouterLink
            v-for="topic in topicRail"
            :key="topic.name"
            class="record-slip"
            :to="{ name: 'home', query: { tag: topic.name } }"
            :aria-current="currentTag === topic.name ? 'true' : undefined"
          >
            <span class="slip-body">
              <span class="slip-title">{{ topic.name }}</span>
              <span class="slip-tags">
                <span class="slip-tag tabular">{{ topic.count }} 条</span>
                <span v-if="currentTag === topic.name" class="slip-tag slip-tag-active">正在筛</span>
              </span>
            </span>
          </RouterLink>
        </nav>
        <RouterLink class="margin-link margin-link-more" :to="{ name: 'tags' }">
          <span>全部 {{ catalog.tags.length }} 个话题</span>
          <span class="micro-label">索引</span>
        </RouterLink>
      </section>

      <section class="margin-section">
        <h2 class="margin-title">
          辟谣常用资源库
          <span class="micro-label">Sources</span>
        </h2>
        <p v-if="!resources.total" class="field-hint">尚无资源条目，登录后可在资源库页登记查证载体。</p>
        <nav class="slip-rail" aria-label="辟谣常用资源清单">
          <a
            v-for="item in resourceRail"
            :key="item.id"
            class="record-slip"
            :href="safeHref(item.url)"
            target="_blank"
            rel="noopener noreferrer nofollow"
          >
            <span class="slip-body">
              <span class="slip-title">{{ item.name }}</span>
              <span class="slip-tags">
                <span class="slip-tag">{{ item.groupName }}</span>
                <span class="slip-tag">{{ item.trust }}</span>
              </span>
            </span>
          </a>
        </nav>
        <RouterLink class="margin-link margin-link-more" :to="{ name: 'resources' }">
          <span>全部 {{ resources.total }} 条资源</span>
          <span class="micro-label">清单</span>
        </RouterLink>
      </section>

      <section class="margin-section">
        <h2 class="margin-title">
          洛琪希图书馆镜像
          <span class="micro-label">Library</span>
        </h2>
        <p class="field-hint">
          访谈与翻译合集的本地备份，共 <b class="tabular">{{ library.books.length }}</b> 册在架；
          {{ library.unlocked ? '本机已凭口令解锁，可分页阅览或直接取书' : '目录公开，阅览与取书均需输入口令' }}。
        </p>
        <RouterLink class="paper-btn margin-lib" :to="{ name: 'library' }">
          <span class="seal-mark" aria-hidden="true">架</span>
          {{ library.unlocked ? '继续阅览' : '输入口令入馆' }}
        </RouterLink>
        <p v-if="auth.isAuthed && library.pending.length" class="micro-label">
          镜像目录内有 {{ library.pending.length }} 个文件待登记
        </p>
      </section>
    </div>
  </aside>
</template>

<style scoped>
.spine-count {
  font-family: var(--font-mono);
  font-size: var(--text-micro);
  color: var(--ink-mute);
  border: var(--grid-rule) solid var(--rule-quiet);
  padding: 1px 5px;
}

.margin-nav {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: var(--space-1);
}
.margin-link {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2);
  min-height: var(--control-min-h);
  padding: var(--space-1) var(--space-3);
  text-decoration: none;
  color: var(--ink-soft);
  font-size: var(--text-small);
  border: var(--grid-rule) solid transparent;
  border-inline-start: 3px solid var(--rule-quiet);
  border-radius: var(--control-radius);
  transition: border-color var(--dur-select) var(--ease-archive),
    background-color var(--dur-select) var(--ease-archive);
}
.margin-link:hover {
  background: var(--paper-leaf);
  border-color: var(--rule-quiet);
  border-inline-start-color: var(--rule-firm);
}
.margin-link[aria-current='page'] {
  background: var(--paper-leaf);
  color: var(--terra-ink);
  font-weight: 700;
  border-inline-start-color: var(--terra-signal);
}
.margin-link:focus-visible {
  outline: var(--focus-ring) solid var(--terra-ink);
  outline-offset: 2px;
}

.paper-range {
  margin-block-end: var(--space-4);
}
.paper-switch {
  margin-block-start: var(--space-2);
}

.slip-tag-active {
  color: var(--terra-signal-ink);
  border-color: currentColor;
}
.margin-link-more {
  margin-block-start: var(--space-2);
}
.margin-lib {
  display: inline-flex;
  text-decoration: none;
}
</style>
