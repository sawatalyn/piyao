<script setup>
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue';
import {
  Autoformat,
  BlockQuote,
  Bold,
  ClassicEditor,
  Essentials,
  Italic,
  Link,
  List,
  Paragraph,
  Strikethrough,
  Underline,
} from 'ckeditor5';
import 'ckeditor5/ckeditor5.css';
import zhCn from 'ckeditor5/translations/zh-cn.js';
import { ANNO_COLORS, PICK_IMAGE_EVENT, YanMarkup } from '../../editor/yan-markup.js';
import { describeError } from '../../api/client.js';
import { useCatalogStore } from '../../stores/catalog.js';
import { useUiStore } from '../../stores/ui.js';

const props = defineProps({
  modelValue: { type: String, default: '' },
  label: { type: String, default: '正文' },
  placeholder: { type: String, default: '' },
});
const emit = defineEmits(['update:modelValue', 'image-added']);

const catalog = useCatalogStore();
const ui = useUiStore();

const mountEl = ref(null);
const fileInput = ref(null);
const editor = shallowRef(null);
const failed = ref('');
const busy = ref(false);
const color = ref(ANNO_COLORS[0]);
const selectionNote = ref('未选中文字时，圈划与划线按钮不可用');

const PEN_COLORS = [
  { key: 'seal', name: '朱砂', hint: '默认' },
  { key: 'gold', name: '藤黄', hint: '' },
  { key: 'indigo', name: '花青', hint: '' },
  { key: 'ink', name: '墨', hint: '' },
];

/** 一屏两部编辑器时笔色必须各自成组：共用 name 会让浏览器把另一部的单选框取消勾选。 */
const penGroup = computed(() => `anno-color-${props.label}`);

const maxMb = computed(() =>
  Math.max(1, Math.round((catalog.limits?.maxImageBytes || 5 * 1024 * 1024) / 1024 / 1024))
);
const wordCount = computed(() => (props.modelValue || '').replace(/<[^>]+>/g, '').trim().length);

/** 编辑器当前持有的那份 HTML：只有外部值与它不同才回灌，免得 setData 把光标抹平。 */
let held = props.modelValue || '';

function noteFromSelection() {
  const instance = editor.value;
  if (!instance) return;
  const selection = instance.model.document.selection;
  if (selection.isCollapsed) {
    selectionNote.value = '未选中文字时，圈划与划线按钮不可用';
    return;
  }
  const text = String(window.getSelection()?.toString() || '').replace(/\s+/g, ' ');
  selectionNote.value = text ? `已选中 ${text.slice(0, 24)}${text.length > 24 ? '…' : ''}` : '选区跨插图，请先选文字';
}

async function create() {
  if (!mountEl.value) return;
  try {
    // 词典文件只是纯数据的默认导出，没有构建工具替它挂载，建实例前自己并进 CKEditor 读的那张全局表。
    Object.assign((globalThis.CKEDITOR_TRANSLATIONS ??= {}), zhCn);
    const instance = await ClassicEditor.create(mountEl.value, {
      licenseKey: 'GPL',
      language: { ui: 'zh-cn', content: 'zh-CN' },
      initialData: held,
      plugins: [
        Essentials,
        Autoformat,
        Paragraph,
        BlockQuote,
        Bold,
        Italic,
        Underline,
        Strikethrough,
        List,
        Link,
        YanMarkup,
      ],
      toolbar: {
        items: [
          'undo',
          'redo',
          '|',
          'bold',
          'italic',
          'underline',
          'strikethrough',
          '|',
          'bulletedList',
          'numberedList',
          'blockQuote',
          '|',
          'yanAnnotationCircle',
          'yanAnnotationLine',
          'yanAnnotationClear',
          '|',
          'link',
          'yanImagePicker',
        ],
      },
      yanAnnotation: {
        colors: ANNO_COLORS,
        getColor: () => color.value,
        canPick: () => !busy.value,
      },
    });
    editor.value = instance;
    instance.model.document.on('change:data', () => {
      held = instance.getData();
      emit('update:modelValue', held);
    });
    instance.model.document.selection.on('change:range', noteFromSelection);
    instance.model.document.selection.on('change:attribute', noteFromSelection);
    instance.on(PICK_IMAGE_EVENT, () => fileInput.value?.click());
    if (held !== instance.getData()) {
      instance.setData(held);
    }
  } catch (err) {
    console.error('辨妄阁：富文本面装载失败', err);
    failed.value = describeError(err);
    ui.notify('富文本面未能装起，请刷新后重试', 'error');
  }
}

onMounted(create);

onBeforeUnmount(async () => {
  const instance = editor.value;
  editor.value = null;
  try {
    await instance?.destroy();
  } catch {
    /* 页面切走时销毁失败无需打扰 */
  }
});

watch(
  () => props.modelValue,
  (value) => {
    const next = value || '';
    if (next === held) return;
    held = next;
    if (editor.value) editor.value.setData(next);
  }
);

async function onFilePicked(event) {
  const file = event.target.files?.[0];
  event.target.value = '';
  if (!file) return;
  const instance = editor.value;
  if (!instance) return;
  busy.value = true;
  try {
    const record = await catalog.uploadImage(file);
    const inserted = instance.plugins.get('YanImageEditing').insertImage({
      src: record.url,
      alt: record.alt,
      mid: record.id,
    });
    if (inserted) {
      held = instance.getData();
      emit('update:modelValue', held);
      emit('image-added', { mid: record.id, url: record.url, alt: record.alt });
      ui.notify('插图已入库，可在下方「图片标注」中圈划重点', 'commit');
    } else {
      ui.notify('此处无法插入插图，请把光标放到正文行上再试', 'error');
    }
  } catch (err) {
    ui.notify(describeError(err), 'error');
  } finally {
    busy.value = false;
    instance.focus();
  }
}
</script>

<template>
  <div class="rich-editor" :data-bw-editor="label">
    <div class="pen-row">
      <fieldset class="anno-colors">
        <legend class="micro-label">笔色</legend>
        <label v-for="item in PEN_COLORS" :key="item.key" class="paper-check color-opt">
          <input v-model="color" type="radio" :name="penGroup" :value="item.key" />
          <span :class="`swatch swatch-${item.key}`"></span>
          <span>{{ item.name }}</span>
          <span v-if="item.hint" class="micro-label">{{ item.hint }}</span>
        </label>
      </fieldset>
      <p class="pen-hint">笔色作用于下一次圈划；插图与格式在下方工具条上取用。</p>
    </div>

    <div v-if="failed" class="editor-failed" role="alert">
      富文本面未能装起：{{ failed }}。请刷新页面重试。
    </div>
    <p v-if="placeholder" class="editor-lead">{{ placeholder }}</p>
    <div v-show="!failed" class="rich-mount">
      <div ref="mountEl"></div>
    </div>

    <p class="editor-foot">
      <span aria-live="polite">{{ selectionNote }}</span>
      <span class="tabular">{{ wordCount }} 字 · 单图上限 {{ maxMb }}MB</span>
    </p>

    <input
      ref="fileInput"
      class="sr-only"
      type="file"
      accept="image/png,image/jpeg,image/gif,image/webp,image/avif"
      @change="onFilePicked"
    />
  </div>
</template>

<style scoped>
.rich-editor {
  border: var(--grid-rule) solid var(--rule-firm);
  background: var(--paper-leaf);

  /* CKEditor 5 的可视令牌换成 Yan 卷面：墨线、纸色、算子朱，方角 */
  --ck-color-base-foreground: var(--paper-deep);
  --ck-color-base-background: var(--paper-leaf);
  --ck-color-base-border: var(--rule-firm);
  --ck-color-base-text: var(--ink);
  --ck-color-base-focus: var(--terra-ink);
  --ck-color-focus-border: var(--terra-ink);
  --ck-color-text: var(--ink);
  --ck-color-toolbar-background: var(--paper-deep);
  --ck-color-toolbar-border: var(--rule-quiet);
  --ck-color-button-default-background: var(--paper-leaf);
  --ck-color-button-default-hover-background: var(--paper-leaf);
  --ck-color-button-default-active-background: var(--paper-deep);
  --ck-color-button-on-background: var(--anno-seal);
  --ck-color-button-on-color: var(--paper-leaf);
  --ck-color-button-on-hover-background: var(--anno-seal);
  --ck-color-dropdown-panel-background: var(--paper-leaf);
  --ck-color-dropdown-panel-border: var(--rule-firm);
  --ck-color-input-background: var(--paper-leaf);
  --ck-color-input-border: var(--rule-firm);
  --ck-color-input-text: var(--ink);
  --ck-color-panel-background: var(--paper-leaf);
  --ck-color-panel-border: var(--rule-firm);
  --ck-color-tooltip-background: var(--terra-ink);
  --ck-color-tooltip-text: var(--paper-leaf);
  --ck-color-editable-blur-selection: var(--rule-quiet);
  --ck-border-radius: 0;
  --ck-box-shadow-focus: none;
  --ck-box-shadow-inner-error: none;
  --ck-box-shadow-outer-error: none;
  --ck-font-face: var(--font-body);
  --ck-font-size-base: 13px;
  --ck-z-default: 60;
}
.pen-row {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  flex-wrap: wrap;
  padding: var(--space-2) var(--space-3);
  background: var(--paper-deep);
  border-block-end: var(--grid-rule) solid var(--rule-quiet);
}
.anno-colors {
  display: flex;
  align-items: center;
  gap: var(--space-1);
  border: var(--grid-rule) solid var(--rule-quiet);
  border-radius: var(--control-radius);
  padding: 0 var(--space-2);
  margin: 0;
  min-height: 32px;
  background: var(--paper-leaf);
}
.anno-colors legend {
  padding-inline: 4px;
}
.color-opt {
  min-height: 30px;
  gap: 4px;
  font-size: var(--text-micro);
}
.swatch {
  display: inline-block;
  inline-size: 12px;
  block-size: 12px;
  border: var(--grid-rule) solid var(--rule-firm);
  border-radius: var(--control-radius);
}
.swatch-seal {
  background: var(--anno-seal);
}
.swatch-gold {
  background: var(--anno-gold);
}
.swatch-indigo {
  background: var(--anno-indigo);
}
.swatch-ink {
  background: var(--anno-ink);
}
.pen-hint {
  margin: 0;
  font-size: var(--text-micro);
  color: var(--ink-mute);
}
.rich-mount {
  position: relative;
}
.editor-lead {
  margin: 0;
  padding: var(--space-2) var(--space-3);
  font-size: var(--text-small);
  color: var(--ink-mute);
  background: var(--paper-deep);
  border-block-end: var(--grid-rule) solid var(--rule-quiet);
}
.editor-failed {
  padding: var(--space-4);
  font-family: var(--font-display);
  color: var(--anno-seal);
  background: var(--paper-deep);
  border-block: var(--grid-rule) solid var(--rule-quiet);
}
.editor-foot {
  display: flex;
  justify-content: space-between;
  gap: var(--space-3);
  flex-wrap: wrap;
  margin: 0;
  padding: var(--space-1) var(--space-3);
  font-size: var(--text-micro);
  color: var(--ink-mute);
  border-block-start: var(--grid-rule) solid var(--rule-quiet);
}

/* 下列选择器命中的是 CKEditor 自己造的 DOM，必须走 :deep() */
.rich-mount :deep(.ck-editor__main > .ck-editor__editable) {
  min-height: 14rem;
  max-height: 32rem;
  overflow-y: auto;
  border: 0;
  border-block-start: var(--grid-rule) solid var(--rule-quiet);
  border-radius: 0;
  padding: var(--space-4);
  background: var(--paper-leaf);
}
.rich-mount :deep(.ck-editor__editable:focus) {
  box-shadow: inset 0 0 0 2px var(--terra-ink);
}
.rich-mount :deep(.ck-toolbar) {
  border: 0;
  border-block-end: var(--grid-rule) solid var(--rule-quiet);
  border-radius: 0;
  background: var(--paper-deep);
  padding: var(--space-1) var(--space-2);
  gap: 2px;
}
.rich-mount :deep(.ck-toolbar .ck-button) {
  border-radius: var(--control-radius);
  border: var(--grid-rule) solid transparent;
  color: var(--ink-soft);
  transition: translate var(--dur-select) var(--ease-archive),
    border-color var(--dur-select) var(--ease-archive);
}
.rich-mount :deep(.ck-toolbar .ck-button:hover:not(.ck-disabled)) {
  border-color: var(--rule-firm);
}
.rich-mount :deep(.ck-toolbar .ck-button:active:not(.ck-disabled)) {
  translate: 0 var(--press-distance);
}
.rich-mount :deep(.ck-toolbar .ck-button:focus-visible) {
  outline: var(--focus-ring) solid var(--terra-ink);
  outline-offset: 2px;
}
.rich-mount :deep(.ck-toolbar .ck-button.ck-on) {
  color: var(--paper-leaf);
  border-color: var(--terra-ink);
}
.rich-mount :deep(.ck-toolbar .ck-toolbar__separator) {
  background: var(--rule-quiet);
  margin-inline: var(--space-1);
}
.rich-mount :deep(.ck-toolbar .ck-toolbar__grouped-dropdown) {
  --ck-color-base-background: var(--paper-deep);
}
/* 批注笔：左边一道印朱，和普通格式键区分开（剪影可辨） */
.rich-mount :deep(.tool-anno) {
  border-inline-start-width: 4px;
  border-inline-start-color: var(--anno-seal);
}
.rich-mount :deep(.tool-anno-clear) {
  border-inline-start-width: 4px;
  border-inline-start-color: var(--rule-firm);
}
.rich-mount :deep(.ck-widget) {
  outline: var(--grid-rule) solid var(--rule-quiet);
  outline-offset: 0;
}
.rich-mount :deep(.ck-widget.ck-widget_selected) {
  outline: var(--focus-ring) solid var(--terra-ink);
}
.rich-mount :deep(.ck-content .rich-fig) {
  margin: var(--space-4) 0;
  border: 0;
  background: var(--terra-field);
}
.rich-mount :deep(.ck-content .rich-img) {
  width: 100%;
}
.rich-mount :deep(.ck-content .rich-cap) {
  padding: var(--space-2) var(--space-3);
  font-size: var(--text-small);
  color: var(--ink-mute);
  border-block-start: var(--grid-rule) solid var(--rule-quiet);
}
.rich-mount :deep(.ck-content blockquote) {
  margin: 0 0 var(--space-4);
  padding: var(--space-3) var(--space-4);
  background: var(--paper-deep);
  border-inline-start: var(--frame-rule) solid var(--rule-firm);
  font-family: var(--font-display);
}
</style>
