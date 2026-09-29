<script setup>
import DOMPurify from 'dompurify';
import { computed } from 'vue';

const props = defineProps({ html: { type: String, default: '' } });

// 服务端已按阅读白名单净化过；前端再挡一道，样式属性一律不进 DOM（本站 CSP 不放行内样式）
const READ_TAGS = [
  'p', 'br', 'hr', 'span', 'strong', 'b', 'em', 'i', 'u', 's', 'sup', 'sub', 'small', 'abbr', 'cite', 'q', 'time',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'li', 'dl', 'dt', 'dd', 'blockquote', 'pre', 'code',
  'img', 'figure', 'figcaption', 'table', 'thead', 'tbody', 'tfoot', 'caption', 'colgroup', 'col', 'tr', 'td', 'th',
  'a', 'div', 'section', 'article', 'header', 'footer', 'aside', 'nav', 'main',
];
const READ_ATTR = [
  'href', 'src', 'alt', 'title', 'class', 'id', 'rel', 'target', 'colspan', 'rowspan', 'scope', 'start',
  'datetime', 'cite', 'span', 'width', 'height', 'loading', 'decoding',
];

const safe = computed(() =>
  DOMPurify.sanitize(String(props.html || ''), {
    ALLOWED_TAGS: READ_TAGS,
    ALLOWED_ATTR: READ_ATTR,
    ALLOW_DATA_ATTR: false,
    FORBID_TAGS: ['style', 'script', 'iframe', 'object', 'embed', 'form', 'input', 'svg', 'math', 'link', 'meta', 'base', 'audio', 'video', 'canvas'],
    FORBID_ATTR: ['style', 'onerror', 'onload', 'onclick', 'srcset', 'formaction'],
  })
);
</script>

<template>
  <div class="epub-body" v-html="safe" />
</template>

<style scoped>
.epub-body {
  font-family: var(--font-body);
  font-size: var(--text-body);
  line-height: 1.75;
  color: var(--terra-ink);
  overflow-wrap: break-word;
}
.epub-body :deep(p) {
  margin: 0 0 var(--space-3);
  text-indent: 2em;
}
.epub-body :deep(h1),
.epub-body :deep(h2),
.epub-body :deep(h3),
.epub-body :deep(h4),
.epub-body :deep(h5),
.epub-body :deep(h6) {
  font-family: var(--font-display);
  line-height: 1.35;
  margin: var(--space-5) 0 var(--space-3);
  text-indent: 0;
}
.epub-body :deep(h1),
.epub-body :deep(h2) {
  font-size: var(--text-title);
  border-block-end: var(--grid-rule) solid var(--rule-quiet);
  padding-block-end: var(--space-1);
}
.epub-body :deep(h3) {
  font-size: var(--text-lead);
}
.epub-body :deep(h4),
.epub-body :deep(h5),
.epub-body :deep(h6) {
  font-size: var(--text-body);
}
.epub-body :deep(ul),
.epub-body :deep(ol) {
  padding-inline-start: var(--space-5);
  margin: 0 0 var(--space-3);
}
.epub-body :deep(blockquote) {
  margin: var(--space-3) 0;
  padding-inline-start: var(--space-4);
  border-inline-start: 3px solid var(--terra-rule);
  color: var(--ink-soft);
}
.epub-body :deep(pre) {
  overflow-x: auto;
  background: var(--paper-leaf);
  border: var(--grid-rule) solid var(--rule-quiet);
  padding: var(--space-3);
  font-family: var(--font-mono);
  font-size: var(--text-small);
}
.epub-body :deep(figure) {
  margin: var(--space-4) 0;
  text-align: center;
}
.epub-body :deep(img) {
  max-inline-size: 100%;
  block-size: auto;
  border: var(--grid-rule) solid var(--rule-quiet);
  background: var(--paper-leaf);
}
.epub-body :deep(figcaption) {
  margin-block-start: var(--space-1);
  font-size: var(--text-micro);
  color: var(--ink-mute);
}
.epub-body :deep(table) {
  inline-size: 100%;
  border-collapse: collapse;
  margin: var(--space-3) 0;
  font-size: var(--text-small);
}
.epub-body :deep(th),
.epub-body :deep(td) {
  border: var(--grid-rule) solid var(--rule-quiet);
  padding: var(--space-1) var(--space-2);
  text-align: start;
}
.epub-body :deep(a) {
  color: var(--terra-ink);
  text-decoration-thickness: 1px;
  text-underline-offset: 2px;
}
.epub-body :deep(.epub-no-asset) {
  display: inline-block;
  inline-size: 100%;
  block-size: 3rem;
  border: var(--grid-rule) dashed var(--rule-quiet);
}
.epub-body :deep(section.epub-chapter) {
  margin-block-end: var(--space-7);
  padding-block-end: var(--space-5);
  border-block-end: var(--grid-rule) solid var(--rule-quiet);
}
.epub-body :deep(section.epub-chapter:last-child) {
  border-block-end: 0;
}
</style>
