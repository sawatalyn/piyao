<script setup>
import { computed, onMounted, reactive, ref } from 'vue';
import { RouterLink, useRoute, useRouter } from 'vue-router';
import RichEditor from '../components/editor/RichEditor.vue';
import ImageAnnotator from '../components/editor/ImageAnnotator.vue';
import TagField from '../components/editor/TagField.vue';
import SourceRows from '../components/editor/SourceRows.vue';
import ConfirmDialog from '../components/paper/ConfirmDialog.vue';
import { describeError } from '../api/client.js';
import { useCatalogStore } from '../stores/catalog.js';
import { useUiStore } from '../stores/ui.js';

const route = useRoute();
const router = useRouter();
const catalog = useCatalogStore();
const ui = useUiStore();

const id = computed(() => (route.params.id ? String(route.params.id) : ''));
const isEdit = computed(() => Boolean(id.value));

const RATINGS = ['不实', '误导', '部分属实', '存疑'];
const LEAVES = [
  { key: 'head', name: '标题与判定', micro: 'Head' },
  { key: 'rumor', name: '谣言案例', micro: 'Claim' },
  { key: 'verdict', name: '辟谣内容', micro: 'Verdict' },
  { key: 'source', name: '材料源与批注', micro: 'Evidence' },
];

const leaf = ref('head');
const busy = ref(false);
const confirmOpen = ref(false);
// 新建无需等取卷，否则按钮会被永久禁用
const loaded = ref(!isEdit.value);
const imageBank = ref([]);

const form = reactive({
  title: '',
  tags: [],
  rumorHtml: '',
  rumorSource: { platform: '', url: '', seenAt: '' },
  verdictHtml: '',
  rating: '',
  // 新建即给一行空材料源，符合"可增删输入框 + 上传按钮"的形态
  sources: [
    {
      id: 's-init',
      title: '',
      url: '',
      org: '',
      collectedAt: new Date().toISOString().slice(0, 10),
      note: '',
      mediaId: '',
    },
  ],
  annotations: {},
  meta: { editor: '', level: '中', scope: '', reviewAt: '', publishedAt: '' },
});

const errors = reactive({ title: '', rumorHtml: '', verdictHtml: '' });

/** <input type="date"> 只认 yyyy-MM-dd：档案里存过完整时间戳的话，不裁就会静默显示为空。 */
function toDateValue(value) {
  const text = String(value ?? '');
  return /^\d{4}-\d{2}-\d{2}T/.test(text) ? text.slice(0, 10) : text;
}

onMounted(async () => {
  if (!isEdit.value) return;
  try {
    const post = await catalog.openPost(id.value);
    form.title = post.title;
    form.tags = [...(post.tags || [])];
    form.rumorHtml = post.rumor?.html || '';
    form.rumorSource = {
      ...form.rumorSource,
      ...(post.rumor?.source || {}),
      seenAt: toDateValue(post.rumor?.source?.seenAt),
    };
    form.verdictHtml = post.verdict?.html || '';
    form.rating = post.verdict?.rating || '';
    form.sources = (post.sources || []).map((row) => ({
      ...row,
      collectedAt: toDateValue(row.collectedAt),
    }));
    form.annotations = JSON.parse(JSON.stringify(post.annotations || {}));
    form.meta = { ...form.meta, ...(post.meta || {}), reviewAt: toDateValue(post.meta?.reviewAt) };
    imageBank.value = (post.media || []).map((media) => ({ mid: media.id, url: media.url, alt: media.alt }));
  } catch (err) {
    ui.notify(describeError(err), 'error');
    await router.replace({ name: 'home' });
  } finally {
    loaded.value = true;
  }
});

function onImageAdded(image) {
  if (!imageBank.value.some((item) => item.mid === image.mid)) {
    imageBank.value.push({ mid: image.mid, url: image.url, alt: image.alt });
  }
}

const filled = computed(() => [
  form.title.trim().length > 0,
  form.rating.length > 0,
  form.rumorHtml.replace(/<[^>]+>/g, '').trim().length > 0,
  form.tags.length > 0,
  form.verdictHtml.replace(/<[^>]+>/g, '').trim().length > 0,
  form.sources.some((row) => (row.title || row.url || row.mediaId)),
]);

const completeness = computed(() => Math.round((filled.value.filter(Boolean).length / 6) * 100));
const ready = computed(() => filled.value.every(Boolean));

function validate() {
  errors.title = form.title.trim() ? '' : '标题不可为空';
  errors.rumorHtml = form.rumorHtml.replace(/<[^>]+>/g, '').trim() ? '' : '谣言案例不可为空';
  errors.verdictHtml = form.verdictHtml.replace(/<[^>]+>/g, '').trim() ? '' : '辟谣内容不可为空';
  return !errors.title && !errors.rumorHtml && !errors.verdictHtml;
}

function payload() {
  return {
    title: form.title.trim(),
    tags: form.tags,
    rumor: { html: form.rumorHtml, source: form.rumorSource },
    verdict: { html: form.verdictHtml, rating: form.rating },
    sources: form.sources,
    annotations: form.annotations,
    meta: form.meta,
  };
}

async function submit() {
  if (!validate()) {
    leaf.value = errors.title ? 'head' : errors.rumorHtml ? 'rumor' : 'verdict';
    ui.notify('卷面仍有必填项未合式', 'error');
    return;
  }
  busy.value = true;
  try {
    const post = await catalog.savePost(payload(), id.value || undefined);
    confirmOpen.value = false;
    ui.notify(isEdit.value ? '修订已归档' : '新档案已用印归档', 'commit');
    await router.push({ name: 'post', params: { id: post.id } });
  } catch (err) {
    ui.notify(describeError(err), 'error');
  } finally {
    busy.value = false;
  }
}

const annotationCount = computed(() =>
  Object.values(form.annotations || {}).reduce((sum, list) => sum + (list?.length || 0), 0)
);
</script>

<template>
  <div class="sheet-inner">
    <header class="sheet-head">
      <h1 class="sheet-title">{{ isEdit ? '修订档案' : '新增辟谣图文' }}</h1>
      <div class="sheet-title-rule" aria-hidden="true"></div>
      <p class="sheet-lead">
        卷分四叶：<b>标题与判定</b>、<b>谣言案例</b>、<b>辟谣内容</b>、<b>材料源与批注</b>。
        重点处用画圈或下划线标出，默认朱砂，可换矿物四色。
      </p>
      <div class="paper-progress completeness">
        <span class="micro-label">
          合式度 <b class="tabular">{{ completeness }}%</b>
          <span v-if="!ready">（尚缺：{{ filled.map((v, i) => (v ? null : ['标题', '结论判定', '谣言案例', '话题标签', '辟谣内容', '材料源'][i])).filter(Boolean).join('、') }}）</span>
        </span>
        <progress :value="completeness" max="100">{{ completeness }}%</progress>
      </div>
    </header>

    <!-- 签名控件：折叠文书叶选（stacked leaves，露出折角，保持阅读顺序） -->
    <nav class="petition" aria-label="卷叶切换">
      <button
        v-for="(item, index) in LEAVES"
        :key="item.key"
        class="leaf"
        :class="{ 'leaf--on': leaf === item.key }"
        type="button"
        :aria-current="leaf === item.key ? 'true' : undefined"
        @click="leaf = item.key"
      >
        <span class="leaf-no">{{ ['一', '二', '三', '四'][index] }}</span>
        <span class="leaf-name">{{ item.name }}</span>
        <span class="micro-label">{{ item.micro }}</span>
      </button>
    </nav>

    <form class="pane editor-pane" :aria-busy="busy ? 'true' : 'false'" @submit.prevent="confirmOpen = true">
      <section v-show="leaf === 'head'">
        <label class="field">
          <span class="field-label">标题</span>
          <input
            v-model="form.title"
            class="paper-input"
            type="text"
            maxlength="120"
            :aria-invalid="errors.title ? 'true' : 'false'"
            :aria-describedby="errors.title ? 'err-title' : 'hint-title'"
            placeholder="写成一句可被核验的话，如：××会致癌？"
          />
          <span v-if="errors.title" id="err-title" class="field-error" role="alert">{{ errors.title }}</span>
          <span v-else id="hint-title" class="field-hint">不超过 120 字，首页卡片直接取此标题</span>
        </label>

        <fieldset class="field">
          <legend class="field-label">结论判定</legend>
          <div class="row rating-row">
            <label v-for="item in RATINGS" :key="item" class="paper-check rating-opt">
              <input v-model="form.rating" type="radio" name="rating" :value="item" />
              <span>{{ item }}</span>
            </label>
          </div>
          <span class="field-hint">四级措辞见页脚体例；判定与证据必须同页可核</span>
        </fieldset>

        <div class="row two-col">
          <label class="field">
            <span class="field-label">谣言来源平台</span>
            <input v-model="form.rumorSource.platform" class="paper-input" type="text" maxlength="40" placeholder="如：短视频 / 家庭群聊" />
          </label>
          <label class="field">
            <span class="field-label">发现时刻</span>
            <input v-model="form.rumorSource.seenAt" class="paper-input" type="date" />
          </label>
          <label class="field span-all">
            <span class="field-label">原始载体链接（可选，http(s)）</span>
            <input v-model="form.rumorSource.url" class="paper-input" type="url" placeholder="https://…" />
          </label>
        </div>

        <div class="row two-col">
          <label class="field">
            <span class="field-label">责任编辑</span>
            <input v-model="form.meta.editor" class="paper-input" type="text" maxlength="40" placeholder="留空则记为建档人" />
          </label>
          <label class="field">
            <span class="field-label">危害等级</span>
            <select v-model="form.meta.level" class="paper-select" aria-label="危害等级">
              <option>高</option>
              <option>中</option>
              <option>低</option>
            </select>
          </label>
          <label class="field">
            <span class="field-label">复核期限</span>
            <input v-model="form.meta.reviewAt" class="paper-input" type="date" />
          </label>
          <label class="field">
            <span class="field-label">传播范围</span>
            <input v-model="form.meta.scope" class="paper-input" type="text" maxlength="60" placeholder="如：本地社群与二手平台" />
          </label>
        </div>
      </section>

      <section v-show="leaf === 'rumor'">
        <h2 class="leaf-title">谣言案例（富文本，可插入图片并圈划）</h2>
        <RichEditor
          v-model="form.rumorHtml"
          label="谣言案例正文"
          placeholder="照录原话，不要改写；随后用画圈/划线标出关键断言"
          @image-added="onImageAdded"
        />
        <p v-if="errors.rumorHtml" class="field-error" role="alert">{{ errors.rumorHtml }}</p>

        <div class="field">
          <span class="field-label">谣言相关话题 tag（纯文本列表，用于向量搜索）</span>
          <TagField v-model="form.tags" :max="catalog.limits.maxTags || 20" />
        </div>

        <ImageAnnotator
          v-if="imageBank.length"
          v-model="form.annotations"
          :images="imageBank"
          class="anno-block"
        />
      </section>

      <section v-show="leaf === 'verdict'">
        <h2 class="leaf-title">辟谣内容（富文本）</h2>
        <RichEditor
          v-model="form.verdictHtml"
          label="辟谣内容正文"
          placeholder="先给结论，再列证据与推理；必要时同样圈划关键处"
          @image-added="onImageAdded"
        />
        <p v-if="errors.verdictHtml" class="field-error" role="alert">{{ errors.verdictHtml }}</p>
      </section>

      <section v-show="leaf === 'source'">
        <h2 class="leaf-title">辟谣材料源（超链接或图片，可增删）</h2>
        <SourceRows v-model="form.sources" :max="catalog.limits.maxSources || 20" />
        <p class="field-hint">
          当前图片标注共 <b class="tabular">{{ annotationCount }}</b> 笔，随档案一并存档，详情页按矢量数据复原到图上。
        </p>
      </section>

      <div class="submit-row">
        <button class="paper-btn seal-press" type="submit" :disabled="busy || !loaded">
          {{ busy ? '归档中…' : isEdit ? '用印修订' : '用印归档' }}
        </button>
        <RouterLink class="paper-btn btn-quiet" :to="isEdit ? { name: 'post', params: { id } } : { name: 'home' }">
          放弃并返回
        </RouterLink>
        <span class="micro-label">未合式项：{{ filled.filter((v) => !v).length }} / 6</span>
      </div>
    </form>

    <ConfirmDialog
      :open="confirmOpen"
      :title="isEdit ? '确认修订归档' : '确认用印归档'"
      :summary="`《${form.title || '（无标题）'}》· 判定：${form.rating || '未选'} · 话题 ${form.tags.length} 个 · 材料源 ${form.sources.length} 条 · 图片标注 ${annotationCount} 笔`"
      :consequence="isEdit ? '修订将覆盖原正文与批注，修订人与时间一并留档。' : '归档后条目出现在卷首，可继续置顶或重排。'"
      :confirm-text="isEdit ? '确认修订' : '确认归档'"
      :busy="busy"
      @confirm="submit"
      @cancel="confirmOpen = false"
    />
  </div>
</template>

<style scoped>
.completeness {
  margin-block-start: var(--space-4);
}
.completeness b {
  color: var(--terra-signal-ink);
}

.petition {
  display: flex;
  gap: var(--space-1);
  margin-block-end: var(--space-4);
  flex-wrap: wrap;
}
.leaf {
  position: relative;
  display: grid;
  gap: 1px;
  inline-size: 9.5rem;
  min-height: 56px;
  padding: var(--space-2) var(--space-3);
  text-align: start;
  background: var(--paper-deep);
  border: var(--grid-rule) solid var(--rule-quiet);
  border-block-end: var(--frame-rule) solid var(--rule-quiet);
  border-radius: var(--control-radius);
  cursor: pointer;
  color: var(--ink-soft);
  transition: translate var(--dur-select) var(--ease-archive),
    border-color var(--dur-select) var(--ease-archive),
    background-color var(--dur-select) var(--ease-archive);
}
.leaf::before {
  content: '';
  position: absolute;
  inset-block-start: 0;
  inset-inline-end: 0;
  width: 11px;
  height: 11px;
  background: linear-gradient(225deg, var(--terra-field) 0 50%, var(--paper-shadow) 50%);
  clip-path: polygon(100% 0, 0 0, 100% 100%);
}
.leaf:hover {
  background: var(--paper-leaf);
  translate: 0 -2px;
}
.leaf:active {
  translate: 0 1px;
}
.leaf:focus-visible {
  outline: var(--focus-ring) solid var(--terra-ink);
  outline-offset: 2px;
}
.leaf--on {
  background: var(--paper-leaf);
  translate: 0 -3px;
  border-color: var(--terra-ink);
  border-block-end-color: var(--terra-signal);
  color: var(--terra-ink);
}
.leaf-no {
  font-family: var(--font-display);
  font-size: var(--text-micro);
  letter-spacing: 0.2em;
  color: var(--ink-mute);
}
.leaf-name {
  font-family: var(--font-display);
  font-size: var(--text-small);
}
.leaf--on .leaf-name {
  font-weight: 700;
}

.editor-pane {
  min-height: 22rem;
}
.leaf-title {
  margin-block-end: var(--space-3);
}
.anno-block {
  margin-block-start: var(--space-4);
}
.two-col {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(14rem, 1fr));
  gap: 0 var(--space-4);
  inline-size: 100%;
}
.span-all {
  grid-column: 1 / -1;
}
.rating-row {
  gap: var(--space-4);
}
.rating-opt {
  min-height: var(--control-min-h);
  font-family: var(--font-display);
  letter-spacing: 0.08em;
}
.submit-row {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  flex-wrap: wrap;
  margin-block-start: var(--space-5);
  padding-block-start: var(--space-4);
  border-block-start: var(--frame-rule) solid var(--rule-firm);
}
</style>
